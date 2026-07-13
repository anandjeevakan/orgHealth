#!/usr/bin/env node
// Org Health analysis pipeline.
//
// Usage:
//   node scripts/analyze-org-health.js --target-org <alias-or-username>
//
// 1. Queries active user assignment counts per Profile and PermissionSet.
// 2. Flags any with 0 active users.
// 3. For each flagged Profile, scans local ValidationRule/Flow/ApexClass source
//    under force-app for the profile's exact name as a string literal
//    ($Profile.Name comparisons, {!$Profile.Name} flow conditions,
//    Profile.Name = '...' SOQL, or any hardcoded literal) -- NOT
//    UserInfo.getProfileId()/User.ProfileId, which are ID-based and out of
//    scope. Case-sensitive exact match only. Excludes the profile's own
//    metadata file.
// 4. Writes analysis/findings.json with per-item user counts, references, and
//    a recommendation.
// 5. For flagged Profiles with zero references, writes
//    analysis/destructiveChanges.xml + analysis/package.xml (a deletion
//    package) for manual review -- this script never deploys it.

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const METADATA_ROOT = path.join(ROOT, 'force-app', 'main', 'default');
const OUT_DIR = path.join(ROOT, 'analysis');

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

const targetOrg = arg('target-org');
if (!targetOrg) {
  console.error('Usage: node scripts/analyze-org-health.js --target-org <alias-or-username>');
  process.exit(1);
}

const IS_WINDOWS = process.platform === 'win32';
// On Windows, execFileSync with shell:true joins args into a single command
// line without quoting them itself, so a multi-word argument (like our SOQL
// query) gets split into separate words by cmd.exe. Quote each arg ourselves
// in that case; non-Windows platforms don't need a shell at all, so
// execFileSync passes the argv array through untouched.
function quoteForCmd(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function sfQuery(soql) {
  const args = ['data', 'query', '--query', soql, '--target-org', targetOrg, '--json'];
  const raw = IS_WINDOWS
    ? execFileSync('sf', args.map(quoteForCmd), { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20, shell: true })
    : execFileSync('sf', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
  const parsed = JSON.parse(raw);
  if (parsed.status !== 0) {
    throw new Error(`SOQL query failed: ${soql}\n${JSON.stringify(parsed, null, 2)}`);
  }
  return parsed.result.records || [];
}

function listMetadataNames(dir, suffix) {
  const full = path.join(METADATA_ROOT, dir);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full)
    .filter((f) => f.endsWith(suffix))
    .map((f) => f.slice(0, -suffix.length));
}

function collectScanFiles() {
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(validationRule-meta\.xml|flow-meta\.xml|cls)$/.test(entry.name)) {
        files.push(full);
      }
    }
  };
  walk(METADATA_ROOT);
  return files;
}

function findReferences(profileName, ownProfileFile) {
  const refs = [];
  const escaped = profileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b${escaped}\\b`);
  for (const file of collectScanFiles()) {
    if (path.resolve(file) === path.resolve(ownProfileFile)) continue;
    const content = fs.readFileSync(file, 'utf8');
    content.split('\n').forEach((line, i) => {
      if (pattern.test(line)) {
        refs.push({ file: path.relative(ROOT, file).split(path.sep).join('/'), line: i + 1, snippet: line.trim() });
      }
    });
  }
  return refs;
}

// --- 1. Active user counts per Profile ---
const userRecords = sfQuery('SELECT Id, Profile.Name FROM User WHERE IsActive = true');
const profileUserCounts = {};
for (const u of userRecords) {
  const name = u.Profile && u.Profile.Name;
  if (!name) continue;
  profileUserCounts[name] = (profileUserCounts[name] || 0) + 1;
}

// --- 1b. Active user counts per PermissionSet (via assignments) ---
const psaRecords = sfQuery(
  'SELECT Id, PermissionSet.Name FROM PermissionSetAssignment WHERE Assignee.IsActive = true'
);
const permSetUserCounts = {};
for (const p of psaRecords) {
  const name = p.PermissionSet && p.PermissionSet.Name;
  if (!name) continue;
  permSetUserCounts[name] = (permSetUserCounts[name] || 0) + 1;
}

// --- Local metadata inventory (what we can actually reason about via source scan) ---
const localProfiles = listMetadataNames('profiles', '.profile-meta.xml');
const localPermSets = listMetadataNames('permissionsets', '.permissionset-meta.xml');

const findings = {
  generatedAt: new Date().toISOString(),
  targetOrg,
  profiles: [],
  permissionSets: [],
};

for (const profileName of localProfiles) {
  const userCount = profileUserCounts[profileName] || 0;
  const ownFile = path.join(METADATA_ROOT, 'profiles', `${profileName}.profile-meta.xml`);
  const entry = { name: profileName, activeUserCount: userCount, references: [] };
  if (userCount === 0) {
    entry.references = findReferences(profileName, ownFile);
    entry.recommendation = entry.references.length === 0 ? 'SAFE_TO_DELETE' : 'DO_NOT_DELETE';
    entry.confidence = entry.references.length === 0 ? 'high' : 'blocked-by-reference';
  } else {
    entry.recommendation = 'IN_USE';
    entry.confidence = 'high';
  }
  findings.profiles.push(entry);
}

for (const psName of localPermSets) {
  const userCount = permSetUserCounts[psName] || 0;
  findings.permissionSets.push({
    name: psName,
    activeUserCount: userCount,
    recommendation: userCount === 0 ? 'FLAGGED_UNUSED' : 'IN_USE',
    note:
      userCount === 0
        ? 'Name-match code scanning is only specified for Profiles per the spec -- review manually before deleting.'
        : undefined,
  });
}

// --- Write findings.json ---
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'findings.json'), JSON.stringify(findings, null, 2));

// --- Deletion package for profiles that are safe to delete (manual review required) ---
const safeToDelete = findings.profiles.filter((p) => p.recommendation === 'SAFE_TO_DELETE');
const destructiveXml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
  ...(safeToDelete.length
    ? ['    <types>', ...safeToDelete.map((p) => `        <members>${p.name}</members>`), '        <name>Profile</name>', '    </types>']
    : []),
  '    <version>60.0</version>',
  '</Package>',
  '',
].join('\n');
fs.writeFileSync(path.join(OUT_DIR, 'destructiveChanges.xml'), destructiveXml);
fs.writeFileSync(
  path.join(OUT_DIR, 'package.xml'),
  ['<?xml version="1.0" encoding="UTF-8"?>', '<Package xmlns="http://soap.sforce.com/2006/04/metadata">', '    <version>60.0</version>', '</Package>', ''].join('\n')
);

// --- Console report ---
console.log('\n=== Org Health Findings ===\n');
console.log('Profiles:');
for (const p of findings.profiles) {
  console.log(`  - ${p.name}: ${p.activeUserCount} active user(s) -> ${p.recommendation}`);
  for (const r of p.references) {
    console.log(`      referenced in ${r.file}:${r.line}  |  ${r.snippet}`);
  }
}
console.log('\nPermission Sets:');
for (const p of findings.permissionSets) {
  console.log(`  - ${p.name}: ${p.activeUserCount} active user(s) -> ${p.recommendation}`);
}
console.log(`\nFindings written to analysis/findings.json`);
console.log(
  `Deletion package written to analysis/destructiveChanges.xml + analysis/package.xml (${safeToDelete.length} profile(s) flagged for deletion)`
);
if (safeToDelete.length === 0) {
  console.log(
    'No profiles are safe to auto-delete -- all 0-user profiles found a code reference blocking deletion, or there are no 0-user profiles.'
  );
}
console.log('\nReview analysis/findings.json and analysis/destructiveChanges.xml before running any deploy against them.\n');
