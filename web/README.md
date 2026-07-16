# Org Health — Lookup Dashboard

React (Vite) app for looking up a single Profile, Role, or Permission Set
and seeing everywhere it's referenced in code (Apex classes, Triggers,
Flows, Validation Rules, and other scanned metadata), using the findings
produced by `scripts/analyze-org-health.js` at the repo root.

## Running

From the repo root, generate (or refresh) findings first — this needs a
live connection to your Salesforce org:

```bash
node scripts/analyze-org-health.js --target-org <alias-or-username>
```

(Optionally pass `--out <ticket-name>` to save that run's findings under
`reports/<ticket-name>/` instead of the default `analysis/` location — useful
for keeping different tickets/orgs' results separate on disk. The app itself
has no concept of "tickets" — it always shows whichever report was generated
most recently.)

Then, from this `web/` directory:

```bash
npm install
npm run dev
```

`npm run dev` and `npm run build` both automatically sync the most recently
generated report into `public/data/findings.json` first (via
`npm run sync-data`), which the app fetches at runtime. If you generate a
new report without restarting the dev server, re-run `npm run sync-data`
manually and refresh the browser.

## Using it

1. Pick a **Type** (Profiles, Roles, or Permission Sets).
2. Pick a **Name** from the second dropdown, populated with every item of
   that type found in the org.
3. See its active-user count, a safe/blocked-to-delete recommendation, and
   every place it's referenced in code, grouped by type (Apex Class,
   Trigger, Flow, Validation Rule, etc.) with the exact file, line, and
   snippet.
