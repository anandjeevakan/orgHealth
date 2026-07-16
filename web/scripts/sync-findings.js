#!/usr/bin/env node
// Copies every findings report -- the legacy analysis/findings.json plus
// anything under reports/<ticket-name>/findings.json -- into
// web/public/data/reports/, and writes an index.json manifest so the React
// app can offer a picker instead of always showing one hardcoded file.
// Run automatically before dev/build.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEST_DIR = path.resolve(__dirname, '..', 'public', 'data', 'reports');

fs.rmSync(DEST_DIR, { recursive: true, force: true });
fs.mkdirSync(DEST_DIR, { recursive: true });

const sources = [];
const legacy = path.join(REPO_ROOT, 'analysis', 'findings.json');
if (fs.existsSync(legacy)) {
  sources.push({ id: 'default', file: legacy });
}
const reportsDir = path.join(REPO_ROOT, 'reports');
if (fs.existsSync(reportsDir)) {
  for (const entry of fs.readdirSync(reportsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(reportsDir, entry.name, 'findings.json');
    if (fs.existsSync(file)) {
      sources.push({ id: entry.name, file });
    }
  }
}

if (sources.length === 0) {
  console.error(
    'No findings reports found (checked analysis/findings.json and reports/*/findings.json).\n' +
      'Run "node scripts/analyze-org-health.js --target-org <org> [--out <ticket-name>]" from the repo root first.'
  );
  process.exit(1);
}

const index = [];
for (const { id, file } of sources) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(path.join(DEST_DIR, `${id}.json`), JSON.stringify(data, null, 2));
  index.push({ id, targetOrg: data.targetOrg, generatedAt: data.generatedAt });
}
index.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
fs.writeFileSync(path.join(DEST_DIR, 'index.json'), JSON.stringify(index, null, 2));

console.log(`Synced ${index.length} report(s) into ${DEST_DIR}`);
for (const r of index) {
  console.log(`  - ${r.id} (${r.targetOrg}, ${r.generatedAt})`);
}
