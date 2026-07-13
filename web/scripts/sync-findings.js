#!/usr/bin/env node
// Copies the repo-root analysis/findings.json (produced by
// scripts/analyze-org-health.js) into web/public/data/ so the React app can
// fetch it as a static asset. Run automatically before dev/build.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..', '..', 'analysis', 'findings.json');
const DEST_DIR = path.resolve(__dirname, '..', 'public', 'data');
const DEST = path.join(DEST_DIR, 'findings.json');

if (!fs.existsSync(SRC)) {
  console.error(
    `No analysis/findings.json found at ${SRC}.\n` +
      'Run "node scripts/analyze-org-health.js --target-org <org>" from the repo root first.'
  );
  process.exit(1);
}

fs.mkdirSync(DEST_DIR, { recursive: true });
fs.copyFileSync(SRC, DEST);
console.log(`Synced ${SRC} -> ${DEST}`);
