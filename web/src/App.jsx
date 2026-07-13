import { useEffect, useState } from 'react';
import './App.css';

const RECOMMENDATION_LABEL = {
  DO_NOT_DELETE: 'Do not delete',
  SAFE_TO_DELETE: 'Safe to delete',
  IN_USE: 'In use',
  FLAGGED_UNUSED: 'Flagged unused',
};

const RECOMMENDATION_CLASS = {
  DO_NOT_DELETE: 'badge badge-danger',
  SAFE_TO_DELETE: 'badge badge-action',
  IN_USE: 'badge badge-ok',
  FLAGGED_UNUSED: 'badge badge-warn',
};

function Badge({ recommendation }) {
  return (
    <span className={RECOMMENDATION_CLASS[recommendation] || 'badge'}>
      {RECOMMENDATION_LABEL[recommendation] || recommendation}
    </span>
  );
}

function ProfileRow({ profile }) {
  const [open, setOpen] = useState(false);
  const hasRefs = profile.references && profile.references.length > 0;

  return (
    <>
      <tr>
        <td>{profile.name}</td>
        <td className="num">{profile.activeUserCount}</td>
        <td>
          <Badge recommendation={profile.recommendation} />
        </td>
        <td>
          {hasRefs ? (
            <button className="link-button" onClick={() => setOpen((o) => !o)}>
              {open ? 'Hide' : 'Show'} {profile.references.length} reference
              {profile.references.length === 1 ? '' : 's'}
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
              {profile.references.map((r, i) => (
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

  const flaggedProfiles = findings.profiles.filter((p) => p.activeUserCount === 0);
  const safeToDelete = findings.profiles.filter((p) => p.recommendation === 'SAFE_TO_DELETE');

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
          <span className="card-value">{findings.profiles.length}</span>
          <span className="card-label">Profiles scanned</span>
        </div>
        <div className="card">
          <span className="card-value">{flaggedProfiles.length}</span>
          <span className="card-label">Profiles with 0 active users</span>
        </div>
        <div className="card">
          <span className="card-value">{safeToDelete.length}</span>
          <span className="card-label">Safe to auto-delete</span>
        </div>
        <div className="card">
          <span className="card-value">
            {findings.permissionSets.filter((p) => p.recommendation === 'FLAGGED_UNUSED').length}
          </span>
          <span className="card-label">Permission sets flagged unused</span>
        </div>
      </section>

      <section>
        <h2>Profiles</h2>
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
            {findings.profiles.map((p) => (
              <ProfileRow key={p.name} profile={p} />
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Permission Sets</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Active users</th>
              <th>Recommendation</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {findings.permissionSets.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td className="num">{p.activeUserCount}</td>
                <td>
                  <Badge recommendation={p.recommendation} />
                </td>
                <td className="muted">{p.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

export default App;
