#!/usr/bin/env node
// Copies the most-recently-generated findings report -- checking the legacy
// analysis/findings.json and every reports/<ticket-name>/findings.json --
// into web/public/data/findings.json, which the React app fetches as a
// single static asset (no ticket/report picker in the UI; --out is purely
// for the user's own on-disk file organization across tickets). Run
// automatically before dev/build.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEST_DIR = path.resolve(__dirname, '..', 'public', 'data');
const DEST = path.join(DEST_DIR, 'findings.json');

const candidates = [];
const legacy = path.join(REPO_ROOT, 'analysis', 'findings.json');
if (fs.existsSync(legacy)) candidates.push(legacy);

const reportsDir = path.join(REPO_ROOT, 'reports');
if (fs.existsSync(reportsDir)) {
  for (const entry of fs.readdirSync(reportsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(reportsDir, entry.name, 'findings.json');
    if (fs.existsSync(file)) candidates.push(file);
  }
}

if (candidates.length === 0) {
  console.error(
    'No findings report found (checked analysis/findings.json and reports/*/findings.json).\n' +
      'Run "node scripts/analyze-org-health.js --target-org <org> [--out <ticket-name>]" from the repo root first.'
  );
  process.exit(1);
}

let latest = candidates[0];
let latestData = JSON.parse(fs.readFileSync(latest, 'utf8'));
for (const file of candidates.slice(1)) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (new Date(data.generatedAt) > new Date(latestData.generatedAt)) {
    latest = file;
    latestData = data;
  }
}

fs.mkdirSync(DEST_DIR, { recursive: true });
fs.writeFileSync(DEST, JSON.stringify(latestData, null, 2));
console.log(`Synced ${latest} -> ${DEST}`);
