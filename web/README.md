# Org Health — Findings Dashboard

React (Vite) app that displays the findings produced by
`scripts/analyze-org-health.js` at the repo root.

## Running

From the repo root, generate (or refresh) the findings first — this needs a
live connection to your Salesforce org:

```bash
node scripts/analyze-org-health.js --target-org <alias-or-username>
```

Then, from this `web/` directory:

```bash
npm install
npm run dev
```

`npm run dev` and `npm run build` both automatically sync
`../analysis/findings.json` into `public/data/findings.json` first (via
`npm run sync-data`), which the app fetches at runtime. If you update the
findings without restarting the dev server, re-run `npm run sync-data`
manually and refresh the browser.
