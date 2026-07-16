# Org Health — Findings Dashboard

React (Vite) app that displays findings produced by
`scripts/analyze-org-health.js` at the repo root, with a report picker for
tracking multiple tickets/orgs over time.

## Running

From the repo root, generate (or refresh) findings for a ticket/org first —
this needs a live connection to your Salesforce org:

```bash
node scripts/analyze-org-health.js --target-org <alias-or-username> --out <ticket-name>
```

Each `--out <ticket-name>` run is saved separately under `reports/<ticket-name>/`,
so results from different tickets/orgs don't overwrite each other. Omit
`--out` to use the legacy single-report location (`analysis/`).

Then, from this `web/` directory:

```bash
npm install
npm run dev
```

`npm run dev` and `npm run build` both automatically sync every report found
(`analysis/findings.json` plus everything under `reports/*/findings.json`)
into `public/data/reports/` first (via `npm run sync-data`), along with an
`index.json` manifest. The app fetches that manifest and shows a **Report**
dropdown when more than one report exists, defaulting to the most recent. If
you generate a new report without restarting the dev server, re-run
`npm run sync-data` manually and refresh the browser.
