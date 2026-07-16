import { useEffect, useState } from 'react';
import './App.css';

const CATEGORY_OPTIONS = [
  { key: 'profiles', label: 'Profiles' },
  { key: 'roles', label: 'Roles' },
  { key: 'permissionSets', label: 'Permission Sets' },
];

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

function App() {
  const [findings, setFindings] = useState(null);
  const [error, setError] = useState(null);
  const [category, setCategory] = useState('');
  const [itemName, setItemName] = useState('');

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

  const items = category ? findings[category] || [] : [];
  const sortedItems = items.slice().sort((a, b) => a.name.localeCompare(b.name));
  const selected = items.find((e) => e.name === itemName) || null;

  function handleCategoryChange(e) {
    setCategory(e.target.value);
    setItemName('');
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>Org Health Lookup</h1>
        <p className="subtitle">
          {findings.targetOrg} · generated {new Date(findings.generatedAt).toLocaleString()}
        </p>
      </header>

      <div className="drilldown-bar">
        <div className="drilldown-field">
          <label htmlFor="category-select">Type</label>
          <select id="category-select" value={category} onChange={handleCategoryChange}>
            <option value="">Select type…</option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="drilldown-field">
          <label htmlFor="item-select">Name</label>
          <select
            id="item-select"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            disabled={!category}
          >
            <option value="">{category ? 'Select…' : 'Choose a type first'}</option>
            {sortedItems.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selected && (
        <section className="detail-panel">
          <div className="detail-header">
            <h2>{selected.name}</h2>
            <Badge recommendation={selected.recommendation} />
          </div>
          <p className="muted">{selected.activeUserCount} active user(s)</p>

          <h3>Used in</h3>
          {selected.references && selected.references.length > 0 ? (
            <ul className="refs-list">
              {selected.references.map((r, i) => (
                <li key={i}>
                  <div className="ref-type">{r.type}</div>
                  <code>
                    {r.file}:{r.line}
                  </code>
                  <pre>{r.snippet}</pre>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              No references found in local Apex classes, triggers, flows, validation rules, or other scanned
              metadata.
            </p>
          )}
        </section>
      )}
    </main>
  );
}

export default App;
