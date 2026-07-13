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

function EntityTable({ title, entities }) {
  return (
    <section>
      <h2>{title}</h2>
      {entities.length === 0 ? (
        <p className="muted">None found locally.</p>
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

function App() {
  const [findings, setFindings] = useState(null);
  const [error, setError] = useState(null);

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

  return (
    <main className="page">
      <header className="page-header">
        <h1>Org Health Findings</h1>
        <p className="subtitle">
          {findings.targetOrg} · generated {new Date(findings.generatedAt).toLocaleString()}
        </p>
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

      {categories.map((c) => (
        <EntityTable key={c.key} title={c.title} entities={c.entities} />
      ))}
    </main>
  );
}

export default App;
