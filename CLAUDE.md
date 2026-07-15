# Org Health — Project Memory

## What this project is

Audits a Salesforce org for unused/redundant Profiles, Permission Sets, and
Roles, cross-checks each 0-user item against real code/config references
(name-match only, not ID-based) so genuinely-referenced-but-unused items
("landmines") aren't recommended for deletion, and generates a
`destructiveChanges.xml` cleanup package for the ones that are actually safe
to remove.

Originated from `org-health-agent-requirements.docx` / a Claude Code handoff
doc — see git history for the full original spec (name-match scan rules,
phased build order).

## Current architecture (as of 2026-07-13)

- **`force-app/main/default/`** — sample Salesforce metadata simulating a
  realistic org needing cleanup: 2 unused ("landmine") profiles, 2 active
  profiles that couldn't be created (org's edition caps custom
  Salesforce-license profiles at 2 — see below), 3 permission sets, 1 role,
  a validation rule, a flow, custom field, and Apex classes (Apex doesn't
  deploy on this particular org's edition — known limitation, not a bug).
- **`scripts/analyze-org-health.js`** — the analysis pipeline. Requires live
  `sf` CLI org access (run on a machine that's authenticated, e.g. the
  developer's Windows machine — this doesn't work from a sandboxed Claude
  Code web session, which has no network path to Salesforce). Queries active
  user counts per Profile/PermissionSet/Role, flags 0-user items, scans local
  ValidationRule/Flow/ApexClass/CustomField/ApprovalProcess/WorkflowRule/
  SharingRules/Group/CustomMetadata source for exact-name string references,
  writes `analysis/findings.json`, and generates
  `analysis/destructiveChanges.xml` + `package.xml` for items with zero
  references (never auto-deploys — manual review required).
- **`web/`** — React (Vite) dashboard reading `analysis/findings.json`
  (synced into `web/public/data/` via `npm run sync-data`, wired into
  predev/prebuild). Shows Profiles/Permission Sets/Roles tables with
  color-coded recommendation badges, expandable code-reference details, and
  a search box (backed by a native `<datalist>`) that filters all three
  tables live.

### Known org-specific limitations (not code bugs)

- This dev org's edition caps custom profiles at 2 total for the "Salesforce"
  user license — `Sales_Manager_Profile`/`Sales_Rep_Profile` were removed
  from the repo because they can never deploy here.
- Apex isn't supported on this org's edition — `SalesRepUserQuery` and
  `RegionalManagerCheck` Apex classes fail to deploy, but are still valid for
  the local source scan (which doesn't require live deployment).
- Base API URL quirks etc. are irrelevant here (that's the HiMomHiDad
  project's UChat integration, a separate codebase).

### Known scan gaps

- **Hierarchy Custom Setting profile-specific overrides** are live *data*
  (keyed by `SetupOwnerId` = a Profile's ID), not retrievable via source
  metadata — not covered by the file scan. Would need a separate live SOQL
  query per flagged item if this is ever wanted.
- The expanded scan file types (formula fields, approval processes, workflow
  rules, sharing rules, groups, custom metadata) are wired into the scanner
  but **not yet exercised by any sample data** — only ValidationRule, Flow,
  and ApexClass references have been proven to work end-to-end so far.

## NEXT PLANNED WORK (not started yet, discussed 2026-07-13, picking up "tomorrow")

**Goal**: turn this from a single-user CLI-driven tool into a **public,
multi-tenant web app** — deployed on the user's Hostinger hosting, where
**any Salesforce admin from any org** (not just this project's org) can:
1. Log in with their own Salesforce org credentials (Salesforce OAuth login
   page, not a custom username/password form).
2. See this same kind of findings dashboard, but generated live for *their*
   org.
3. **Log off** (explicit logout must be supported).
4. **Credentials must never be stored** — no persisted username/password,
   and access tokens should not be persisted long-term either (session-only,
   cleared on logout). This is a hard requirement, not a nice-to-have.

### Open architectural questions — MUST be resolved before building

These were asked and the user deferred answering (dismissed the question,
said "tomorrow") — ask again before starting:

1. **Does the Hostinger deployment have Node.js/backend hosting available**
   (like the HiMomHiDad Express app already running on the same Hostinger
   VPS), or is this meant to be purely static file hosting?
   - If backend available (recommended): use the OAuth **Web Server flow
     with PKCE**, proxy Salesforce API calls server-side. This avoids CORS
     entirely (Salesforce's REST/Tooling API endpoints don't allow arbitrary
     cross-origin browser fetches unless each visiting org's admin manually
     whitelists the app's domain in their own org's CORS allowlist — a real
     blocker for a public multi-tenant tool if going pure client-side).
   - If static-only: stuck with the less-secure OAuth **Implicit flow**, and
     every visiting admin would need to add the domain to their own org's
     CORS settings before the tool works for them at all. Worth strongly
     recommending against this if avoidable.
2. **Is there already a Salesforce Connected App configured** for this tool
   (Consumer Key/Client ID, callback URL), or does one need to be created
   from scratch (Setup → App Manager → New Connected App)? A single
   Connected App works across all orgs by default (not tied to one specific
   org) — that's standard and fine for the multi-tenant goal.

### Implications once those are answered

- If a live in-browser (or backend-proxied) data pipeline replaces the
  current CLI-driven `analyze-org-health.js` script, the **code-reference
  scanning part** (currently reading local retrieved source files) will need
  to fetch Apex/Flow/ValidationRule/etc. source via the **Tooling API**
  instead, since a live multi-tenant app can't rely on `sf project retrieve`
  having already run locally for an arbitrary visiting org.
- Decide whether the existing `scripts/analyze-org-health.js` (CLI-driven,
  single-org) stays as a separate/simpler tool, or gets fully superseded by
  the web app's live pipeline.

## Distribution model exploration (2026-07-14) — public web app REJECTED

Spent a session exploring how to package/distribute this as a real product,
beyond the single-org CLI tool. Options considered, in the order discussed:

1. **Public multi-tenant web app** (any org's admin logs in via Salesforce
   OAuth) — this is the option `NEXT PLANNED WORK` above describes. Still
   theoretically on the table, but same CORS/OAuth complexity applies.
2. **Chrome extension** — piggybacks on the admin's already-logged-in
   Salesforce browser session (same trick as the popular **Salesforce
   Inspector Reloaded** extension), so **no OAuth/Connected App/CORS
   ceremony needed at all**. The catch: a browser extension can't read local
   files, so the code-reference scan (currently grep-ing local
   ValidationRule/Flow/ApexClass source) would need to be rewritten to pull
   Apex/Flow bodies via the **Tooling API** instead — same rewrite needed
   for the web-app and unlocked-package options too, not unique to this one.
3. **Salesforce Unlocked Package** (native LWC + Apex, installed directly
   into the target org via an install link) — explored in depth, then
   **rejected**. Reasoning:
   - No Salesforce Partner Program / ISV account needed to build or share an
     unlocked package (common misconception) — Dev Hub is free on any
     Developer Edition org, and namespace registration (if wanted) is also
     free via a separate registry org. Partner Program is only needed to
     *list on AppExchange*, not to build or hand someone a direct install
     link.
   - BUT: making the code-reference scan work from inside Apex requires an
     Apex callout **back into the same org's own Tooling API**, and
     Salesforce does NOT auto-authorize that. It requires manually creating,
     per installing org: a Connected App → an Auth Provider (type
     "Salesforce") → wiring the generated callback URL back into the
     Connected App → a Named Credential (Named Principal, OAuth 2.0,
     referencing the Auth Provider) — a real one-time, easy-to-get-wrong,
     multi-step manual setup cost per org. This undercut the entire
     "easiest to use" reason this option was on the table, so it was
     dropped. (Concrete steps for this are in chat history if ever
     revisited, not reproduced here since the option was abandoned.)
4. **GitHub-downloadable CLI + React dashboard** — what's actually built and
   working today (this repo). No new hurdles. Chosen reasoning at the time:
   full local filesystem access already solves the code-scan problem
   naturally, appeals to security-conscious admins who want to audit the
   code before running it against their org, zero hosting liability.

**Where this left off**: leaning toward either (a) shipping what's already
built as-is (GitHub CLI + React dashboard, this repo), or (b) revisiting the
**Chrome extension** option specifically because it turned out to dodge the
exact self-auth wall that killed the unlocked-package idea — same Tooling
API rewrite needed either way, but no Named Credential ceremony. No final
decision made. Also brainstormed product names (`AdminAlly`/`OrgCopilot`
favorites, `Cleanforce`-adjacent naming avoided due to Salesforce's known
"-force" trademark enforcement).

**User asked to understand "headless architecture" more** (in the context of
this React dashboard consuming a static `findings.json` rather than a live
API — confirmed it qualifies, closer to a JAMstack-style headless pattern
than a live headless-CMS pattern) — pick this up as a learning/discussion
topic next session if raised again.

## Possible reframe (2026-07-15): personal tool, not public product

User revealed real context that changes the calculus: they have **multiple
real work tickets** requiring this kind of profile/role/permission-set
audit work — meaning the actual near-term need may be a **personal,
repeatable, multi-org tool for their own ticket work**, not a public product
for strangers to install. If that's the direction, the entire distribution
debate above (Chrome extension vs unlocked package vs web app) becomes
moot — none of that packaging matters for solo/internal use.

**Proposed idea, not yet built, pending discussion**: keep the CLI + React
dashboard exactly as-is, but add:
1. An `--out <path>` flag on `scripts/analyze-org-health.js` so each
   ticket's findings get saved to a distinct file (e.g.
   `reports/TICKET-1234.json`) instead of overwriting the single
   `analysis/findings.json` every run.
2. A report picker in the React dashboard (dropdown listing everything in
   `reports/`) so it becomes a personal ticket-history viewer rather than
   always showing one hardcoded file.
3. Workflow per ticket stays simple: `sf org login web --alias ticket1234`
   for whichever org that ticket concerns, run the analysis with `--out`,
   view/compare in the dashboard.

**Not decided yet** — whether to go this "personal tool" direction, or still
pursue one of the public-distribution options above, or both (personal tool
now, revisit public packaging later). Ask which way to go before building
either the multi-report support or any distribution-packaging work.
