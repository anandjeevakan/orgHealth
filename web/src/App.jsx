import { useEffect, useState } from 'react';
import './App.css';

const RECOMMENDATION_LABEL = {
  DO_NOT_DELETE: 'Do not delete',
  SAFE_TO_DELETE: 'Safe to delete',
  IN_USE: 'In use',
};

const RECOMMENDATION_CLASS = {
  DO_NOT_DELETE: 'badge badge-danger',
  SAFE_TO_DELETE: 'badge badge-action',
  IN_USE: 'badge badge-ok',
};

function Badge({ recommendation }) {
  return (
    <span className={RECOMMENDATION_CLASS[recommendation] || 'badge'}>
      {RECOMMENDATION_LABEL[recommendation] || recommendation}
    </span>
  );
}

function EntityRow({ entity }) {
  const [open, setOpen] = useState(false);
  const hasRefs = entity.references && entity.references.length > 0;

  return (
    <>
      <tr>
        <td>{entity.name}</td>
        <td className="num">{entity.activeUserCount}</td>
        <td>
          <Badge recommendation={entity.recommendation} />
        </td>
        <td>
          {hasRefs ? (
            <button className="link-button" onClick={() => setOpen((o) => !o)}>
              {open ? 'Hide' : 'Show'} {entity.references.length} reference
              {entity.references.length === 1 ? '' : 's'}
            </button>
          ) : (
            <span className="muted">none</span>
          )}
        </td>
      </tr>
      {open && hasRefs && (
        <tr className="refs-row">
          <td colSpan={4}>
            <ul className="refs-list">
              {entity.references.map((r, i) => (
                <li key={i}>
                  <code>
                    {r.file}:{r.line}
                  </code>
                  <pre>{r.snippet}</pre>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

function EntityTable({ title, entities, filtered }) {
  return (
    <section>
      <h2>{title}</h2>
      {entities.length === 0 ? (
        <p className="muted">{filtered ? 'No matches.' : 'None found locally.'}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Active users</th>
              <th>Recommendation</th>
              <th>Code references</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((e) => (
              <EntityRow key={e.name} entity={e} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function toCsvCell(value) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

// Exports whatever is currently visible (i.e. respects active filters) as a
// single CSV -- opens natively in Excel. Avoids the `xlsx` npm package,
// which only has unpatched high-severity CVEs published to the npm registry
// (SheetJS moved patched builds to their own CDN after a licensing dispute).
function exportToCsv(categories) {
  const rows = [['Category', 'Name', 'Active Users', 'Recommendation', 'References']];
  for (const c of categories) {
    for (const e of c.entities) {
      const refs = (e.references || []).map((r) => `${r.file}:${r.line}`).join(' | ');
      rows.push([c.title, e.name, e.activeUserCount, RECOMMENDATION_LABEL[e.recommendation] || e.recommendation, refs]);
    }
  }
  const csv = rows.map((row) => row.map(toCsvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'org-health-findings.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function App() {
  const [findings, setFindings] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedProfiles, setSelectedProfiles] = useState([]);

  useEffect(() => {
    fetch('/data/findings.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setFindings)
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <main className="page">
        <p className="error">
          Couldn't load findings: {error}. Run{' '}
          <code>node scripts/analyze-org-health.js --target-org &lt;org&gt;</code>{' '}
          from the repo root, then <code>npm run sync-data</code> in <code>web/</code>.
        </p>
      </main>
    );
  }

  if (!findings) {
    return (
      <main className="page">
        <p>Loading findings…</p>
      </main>
    );
  }

  const categories = [
    { key: 'profiles', title: 'Profiles', entities: findings.profiles },
    { key: 'permissionSets', title: 'Permission Sets', entities: findings.permissionSets },
    { key: 'roles', title: 'Roles', entities: findings.roles || [] },
  ];
  const allEntities = categories.flatMap((c) => c.entities);
  const flagged = allEntities.filter((e) => e.activeUserCount === 0);
  const safeToDelete = allEntities.filter((e) => e.recommendation === 'SAFE_TO_DELETE');
  const doNotDelete = allEntities.filter((e) => e.recommendation === 'DO_NOT_DELETE');

  const needle = search.trim().toLowerCase();
  const isFiltering = needle.length > 0 || selectedProfiles.length > 0;
  const visibleCategories = categories.map((c) => {
    let entities = needle ? c.entities.filter((e) => e.name.toLowerCase().includes(needle)) : c.entities;
    if (c.key === 'profiles' && selectedProfiles.length > 0) {
      entities = entities.filter((e) => selectedProfiles.includes(e.name));
    }
    return { ...c, entities };
  });

  return (
    <main className="page">
      <header className="page-header">
        <div className="page-header-row">
          <div>
            <h1>Org Health Findings</h1>
            <p className="subtitle">
              {findings.targetOrg} · generated {new Date(findings.generatedAt).toLocaleString()}
            </p>
          </div>
          <button className="export-button" onClick={() => exportToCsv(visibleCategories)}>
            Export to Excel (CSV)
          </button>
        </div>
      </header>

      <section className="summary-cards">
        <div className="card">
          <span className="card-value">{allEntities.length}</span>
          <span className="card-label">Profiles, permission sets & roles scanned</span>
        </div>
        <div className="card">
          <span className="card-value">{flagged.length}</span>
          <span className="card-label">With 0 active users</span>
        </div>
        <div className="card">
          <span className="card-value">{safeToDelete.length}</span>
          <span className="card-label">Safe to auto-delete</span>
        </div>
        <div className="card">
          <span className="card-value">{doNotDelete.length}</span>
          <span className="card-label">Blocked by a code reference</span>
        </div>
      </section>

      <div className="search-bar">
        <input
          type="search"
          list="entity-names"
          placeholder="Search a profile, permission set, or role…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search profiles, permission sets, and roles"
        />
        <datalist id="entity-names">
          {allEntities.map((e) => (
            <option key={e.name} value={e.name} />
          ))}
        </datalist>
        {isFiltering && (
          <button
            className="link-button"
            onClick={() => {
              setSearch('');
              setSelectedProfiles([]);
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="multiselect-bar">
        <label htmlFor="profile-multiselect">Filter Profiles (multi-select)</label>
        <select
          id="profile-multiselect"
          multiple
          size={Math.min(Math.max(findings.profiles.length, 3), 6)}
          value={selectedProfiles}
          onChange={(e) => setSelectedProfiles(Array.from(e.target.selectedOptions, (o) => o.value))}
        >
          {findings.profiles.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <p className="hint">Ctrl/Cmd-click (or Shift-click for a range) to select multiple.</p>
      </div>

      {visibleCategories.map((c) => (
        <EntityTable key={c.key} title={c.title} entities={c.entities} filtered={isFiltering} />
      ))}
    </main>
  );
}

export default App;
