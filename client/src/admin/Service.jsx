import { usePoll } from '../api.js';
import { pct, since, when } from '../format.js';
import { Chip, Dot, Link, Ticks } from './parts.jsx';

export default function Service({ id }) {
  const { data, error } = usePoll(`/api/service/${id}`, 30000);
  if (!data) return <div className="loading">{error ? `Could not load this service: ${error}` : 'Loading…'}</div>;
  const { service: s, check: c, container: k, extras } = data;
  const why = c?.status === 'bad'
    ? (c.httpStatus ? `HTTP ${c.httpStatus}` : c.errors?.[0] || 'check failing')
    : null;

  return (
    <section className="view">
      <Link className="back" to="/">← Overview</Link>
      <header className="topbar">
        <h1 className="svc-title"><Dot status={data.status} />{s.name}</h1>
        <div className="meta">
          <span>{s.kind === 'app' ? 'App' : 'Tool'}{s.host ? ` · ${s.host}` : ''}{s.container ? ` · container ${s.container}` : ''}</span>
          {s.url && <a className="btn" href={s.url} target="_blank" rel="noreferrer">Open {s.name} ↗</a>}
          {data.demo && <span className="mockflag">Demo data</span>}
        </div>
      </header>

      {why && (
        <div className="problems">
          <div className="prob bad">
            <span className="stripe" /><span className="pill">Down</span>
            <p><b>{why}</b>{k?.state === 'running' && <span> · the container is running, so the app itself is stuck or still starting</span>}</p>
            <time>{since(c.failingSince) || ''}</time>
          </div>
        </div>
      )}

      <div className="grid2">
        <article className="card">
          <div className="card-head"><h3>Check history</h3><span className="sub">Gatus · last 24 h</span></div>
          {c ? (
            <>
              <Ticks ticks={c.ticks} />
              <dl className="kv">
                <dt>Last check</dt><dd>{when(c.lastCheck)}</dd>
                <dt>Last success</dt><dd>{when(c.lastSuccess)}</dd>
                <dt>Uptime 24 h</dt><dd>{pct(c.uptime24h)}</dd>
                <dt>Median response</dt><dd>{c.medianMs != null ? `${c.medianMs} ms` : '—'}</dd>
              </dl>
            </>
          ) : <p className="note">No Gatus check named "{s.check}". Add one to the Gatus config.</p>}
        </article>
        <article className="card">
          <div className="card-head"><h3>Container</h3><span className="sub">read-only socket proxy</span></div>
          {k ? (
            <dl className="kv">
              <dt>State</dt><dd><Chip level={k.state === 'running' ? (k.health === 'unhealthy' ? 'bad' : 'ok') : 'bad'}>{k.state}{k.health ? ` · ${k.health}` : ''}</Chip></dd>
              <dt>Status</dt><dd>{k.status}</dd>
              <dt>Image</dt><dd className="wrap">{k.image}</dd>
            </dl>
          ) : <p className="note">{s.container ? `No container named "${s.container}" on ${s.host}.` : 'No container set for this service.'}</p>}
        </article>
      </div>

      {extras?.length > 0 && (
        <div className="grid2">
          {extras.map(x => (
            <article className="card" key={x.title}>
              <div className="card-head"><h3>{x.title}</h3></div>
              {x.rows.length ? (
                <ul className="queue">{x.rows.map((r, i) => (
                  <li key={i}>
                    <span className="q-label">{r.level && <Dot status={r.level} label={`${r.label}: ${r.value}`} />}{r.label}</span>
                    <span className={r.level === 'bad' ? 'neg' : undefined}>{r.value}</span>
                  </li>
                ))}</ul>
              ) : <p className="note">{x.empty}</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
