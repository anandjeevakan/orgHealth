#!/usr/bin/env node
// Org Health analysis pipeline.
//
// Usage:
//   node scripts/analyze-org-health.js --target-org <alias-or-username> [--out <ticket-name>]
//
// --out is optional. Omit it to keep writing to analysis/ (legacy, single
// report). Pass a name (e.g. --out TICKET-1234) to instead write into
// reports/<ticket-name>/, keeping each ticket's/org's findings separate
// instead of overwriting the same file on every run -- meant for repeated
// personal use across many unrelated tickets/orgs over time.
//
// 1. Queries active user assignment counts per Profile, PermissionSet, and Role.
// 2. For every item (regardless of active user count, so any profile/role/
//    permission set can be looked up), scans local source under force-app
//    for the item's exact name as a string literal ($Profile.Name
//    comparisons, {!$Profile.Name} flow conditions, Profile.Name/
//    UserRole.Name = '...' SOQL, formula-field references, or any hardcoded
//    literal in Apex classes/triggers, Approval Processes, Workflow Rules,
//    Sharing Rules, Public Groups, or Custom Metadata records) -- NOT
//    UserInfo.getProfileId()/User.ProfileId/UserInfo.getUserRoleId(), which
//    are ID-based and out of scope. Case-sensitive exact match only.
//    Excludes the item's own metadata file.
//    NOTE: Hierarchy Custom Setting profile-specific overrides are *data*
//    (keyed by SetupOwnerId), not retrievable via source metadata, so they
//    aren't covered by this file scan -- would need a separate live query.
// 3. Flags 0-user items and writes analysis/findings.json with per-item user
//    counts, references (each tagged with a type: Apex Class, Flow, Trigger,
//    Validation Rule, etc.), and a recommendation.
// 4. For flagged items with zero references, writes
//    analysis/destructiveChanges.xml + analysis/package.xml (a deletion
//    package) for manual review -- this script never deploys it.

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const METADATA_ROOT = path.join(ROOT, 'force-app', 'main', 'default');

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

const targetOrg = arg('target-org');
if (!targetOrg) {
  console.error('Usage: node scripts/analyze-org-health.js --target-org <alias-or-username> [--out <ticket-name>]');
  process.exit(1);
}

const ticketName = arg('out');
// Sanitize to a safe folder/file name segment -- avoid path traversal or
// accidentally writing outside reports/.
const safeTicketName = ticketName ? ticketName.replace(/[^A-Za-z0-9_.-]/g, '_') : null;
const OUT_DIR = safeTicketName ? path.join(ROOT, 'reports', safeTicketName) : path.join(ROOT, 'analysis');
const REPORT_LABEL = safeTicketName ? `reports/${safeTicketName}` : 'analysis';

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

// File suffixes that can plausibly contain a hardcoded Profile/PermissionSet/
// Role name: validation rules & flows ($Profile.Name formulas), Apex classes
// and triggers (SOQL/string literals), formula fields, approval processes,
// workflow rules, sharing rules (role-based sharedTo/sharedFrom), public
// groups (can include roles as members), and custom metadata records (often
// used to store config like AllowedProfile__c = '...').
const SCAN_FILE_PATTERN =
  /\.(validationRule-meta\.xml|flow-meta\.xml|cls|trigger|field-meta\.xml|approvalProcess-meta\.xml|workflow-meta\.xml|sharingRules-meta\.xml|group-meta\.xml|md-meta\.xml)$/;

// Friendly labels for the UI, derived from file suffix.
const REFERENCE_TYPE_BY_SUFFIX = [
  [/\.validationRule-meta\.xml$/, 'Validation Rule'],
  [/\.flow-meta\.xml$/, 'Flow'],
  [/\.trigger$/, 'Trigger'],
  [/\.cls$/, 'Apex Class'],
  [/\.field-meta\.xml$/, 'Formula Field'],
  [/\.approvalProcess-meta\.xml$/, 'Approval Process'],
  [/\.workflow-meta\.xml$/, 'Workflow Rule'],
  [/\.sharingRules-meta\.xml$/, 'Sharing Rule'],
  [/\.group-meta\.xml$/, 'Public Group'],
  [/\.md-meta\.xml$/, 'Custom Metadata'],
];
function referenceType(file) {
  const match = REFERENCE_TYPE_BY_SUFFIX.find(([re]) => re.test(file));
  return match ? match[1] : 'Other';
}

function collectScanFiles() {
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SCAN_FILE_PATTERN.test(entry.name)) {
        files.push(full);
      }
    }
  };
  walk(METADATA_ROOT);
  return files;
}

function findReferences(name, ownFile) {
  const refs = [];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b${escaped}\\b`);
  for (const file of collectScanFiles()) {
    if (ownFile && path.resolve(file) === path.resolve(ownFile)) continue;
    const content = fs.readFileSync(file, 'utf8');
    const relFile = path.relative(ROOT, file).split(path.sep).join('/');
    content.split('\n').forEach((line, i) => {
      if (pattern.test(line)) {
        refs.push({ file: relFile, line: i + 1, snippet: line.trim(), type: referenceType(relFile) });
      }
    });
  }
  return refs;
}

// Builds findings entries for one entity type: for each locally-known name,
// looks up its active user count and scans for code references (regardless
// of user count -- lookups can target any profile/role/permission set, not
// just unused ones). Recommendation/confidence are still driven by whether
// it has 0 active users and/or a blocking reference.
function buildEntries(names, userCounts, metadataDir, metadataSuffix) {
  return names.map((name) => {
    const userCount = userCounts[name] || 0;
    const ownFile = path.join(METADATA_ROOT, metadataDir, `${name}${metadataSuffix}`);
    const references = findReferences(name, ownFile);
    const entry = { name, activeUserCount: userCount, references };
    if (userCount === 0) {
      entry.recommendation = references.length === 0 ? 'SAFE_TO_DELETE' : 'DO_NOT_DELETE';
      entry.confidence = references.length === 0 ? 'high' : 'blocked-by-reference';
    } else {
      entry.recommendation = 'IN_USE';
      entry.confidence = 'high';
    }
    return entry;
  });
}

function countBy(records, path_) {
  const counts = {};
  for (const r of records) {
    const name = path_(r);
    if (!name) continue;
    counts[name] = (counts[name] || 0) + 1;
  }
  return counts;
}

// --- 1. Active user counts per Profile, PermissionSet (via assignment), and Role ---
const profileUserCounts = countBy(
  sfQuery('SELECT Id, Profile.Name FROM User WHERE IsActive = true'),
  (u) => u.Profile && u.Profile.Name
);
const permSetUserCounts = countBy(
  sfQuery('SELECT Id, PermissionSet.Name FROM PermissionSetAssignment WHERE Assignee.IsActive = true'),
  (p) => p.PermissionSet && p.PermissionSet.Name
);
const roleUserCounts = countBy(
  sfQuery('SELECT Id, UserRole.Name FROM User WHERE IsActive = true AND UserRoleId != null'),
  (u) => u.UserRole && u.UserRole.Name
);

// --- Local metadata inventory (what we can actually reason about via source scan) ---
const localProfiles = listMetadataNames('profiles', '.profile-meta.xml');
const localPermSets = listMetadataNames('permissionsets', '.permissionset-meta.xml');
const localRoles = listMetadataNames('roles', '.role-meta.xml');

const findings = {
  generatedAt: new Date().toISOString(),
  targetOrg,
  profiles: buildEntries(localProfiles, profileUserCounts, 'profiles', '.profile-meta.xml'),
  permissionSets: buildEntries(localPermSets, permSetUserCounts, 'permissionsets', '.permissionset-meta.xml'),
  roles: buildEntries(localRoles, roleUserCounts, 'roles', '.role-meta.xml'),
};

// --- Write findings.json ---
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'findings.json'), JSON.stringify(findings, null, 2));

// --- Deletion package for entities that are safe to delete (manual review required) ---
const DELETABLE_TYPES = [
  { key: 'profiles', metadataTypeName: 'Profile' },
  { key: 'permissionSets', metadataTypeName: 'PermissionSet' },
  { key: 'roles', metadataTypeName: 'Role' },
];
const safeToDeleteByType = DELETABLE_TYPES.map(({ key, metadataTypeName }) => ({
  metadataTypeName,
  items: findings[key].filter((e) => e.recommendation === 'SAFE_TO_DELETE'),
})).filter((t) => t.items.length > 0);

const destructiveXml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
  ...safeToDeleteByType.flatMap(({ metadataTypeName, items }) => [
    '    <types>',
    ...items.map((e) => `        <members>${e.name}</members>`),
    `        <name>${metadataTypeName}</name>`,
    '    </types>',
  ]),
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
const totalSafeToDelete = safeToDeleteByType.reduce((sum, t) => sum + t.items.length, 0);
function printSection(title, entries) {
  console.log(`\n${title}:`);
  for (const e of entries) {
    console.log(`  - ${e.name}: ${e.activeUserCount} active user(s) -> ${e.recommendation}`);
    for (const r of e.references) {
      console.log(`      referenced in ${r.file}:${r.line}  |  ${r.snippet}`);
    }
  }
}
console.log('\n=== Org Health Findings ===');
printSection('Profiles', findings.profiles);
printSection('Permission Sets', findings.permissionSets);
printSection('Roles', findings.roles);
console.log(`\nFindings written to ${REPORT_LABEL}/findings.json`);
console.log(
  `Deletion package written to ${REPORT_LABEL}/destructiveChanges.xml + ${REPORT_LABEL}/package.xml (${totalSafeToDelete} item(s) flagged for deletion)`
);
if (totalSafeToDelete === 0) {
  console.log(
    'Nothing is safe to auto-delete -- all 0-user items found a code reference blocking deletion, or there are no 0-user items.'
  );
}
console.log(`\nReview ${REPORT_LABEL}/findings.json and ${REPORT_LABEL}/destructiveChanges.xml before running any deploy against them.\n`);
