import React from 'react';
import { SiObsidian } from 'react-icons/si';
import { timeAgo } from '../format';

// Today's notes in the Albyte vault: new (frontmatter date is today) and updated
export default function VaultActivity({ data }) {
  if (!data) return <section className="widget">Loading Albyte...</section>;
  if (!data.reachable) {
    return (
      <section className="widget vault">
        <h2><span><SiObsidian /> Albyte</span></h2>
        <div className="widget-error">{data.error || 'Not reachable'}</div>
      </section>
    );
  }

  return (
    <section className="widget vault">
      <h2>
        <span><SiObsidian /> Albyte today</span>
        <span className="h2-meta">{data.notes} notes</span>
      </h2>
      <div className="vault-counts">
        <span className="pill green">{data.newCount} new</span>
        <span className="pill amber">{data.updatedCount} updated</span>
      </div>
      {data.recent.length === 0 ? (
        <div className="empty">Nothing written today yet</div>
      ) : (
        <ul className="vault-list">
          {data.recent.map(n => (
            <li key={n.path}>
              <span className={`dot ${n.kind === 'new' ? 'green' : 'amber'}`} />
              <span className="vault-title" title={n.path}>{n.title}</span>
              <span className="muted">{n.folder} · {timeAgo(n.modified)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
