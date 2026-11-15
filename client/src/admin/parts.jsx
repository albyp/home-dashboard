import { navigate } from '../nav.js';

// ok | warn | bad | off | unknown
export function Dot({ status = 'ok', label }) {
  const cls = { ok: '', warn: 'warn', bad: 'bad', off: 'off', unknown: 'unknown' }[status] ?? 'unknown';
  return <span className={`dot ${cls}`} role="img" aria-label={label || status} />;
}

export function Chip({ level = 'ok', children }) {
  return <span className={`st ${level}`}>{children}</span>;
}

// Internal link without a page reload
export function Link({ to, className, children, ...rest }) {
  return (
    <a
      href={to}
      className={className}
      onClick={e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

// CPU sparkline, 0–100 on the y axis
export function Spark({ values, label }) {
  if (!values || values.length < 2) return <div className="spark empty">Collecting history…</div>;
  const step = 100 / (values.length - 1);
  const y = v => 32 - (Math.min(100, Math.max(0, v)) / 100) * 30;
  const pts = values.map((v, i) => `${(i * step).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
  return (
    <svg className="spark" viewBox="0 0 100 34" preserveAspectRatio="none" role="img" aria-label={label}>
      <line className="gridln" x1="0" y1="17" x2="100" y2="17" />
      <path className="area-fill" d={`M0,34 L${pts.replace(/ /g, ' L')} L100,34 Z`} />
      <polyline className="ln" points={pts} />
    </svg>
  );
}

// 48 half-hour slots from Gatus: 0 no data, 1 ok, 2 slow, 3 failed
export function Ticks({ ticks }) {
  const failed = (ticks || []).filter(t => t === 3).length;
  return (
    <div className="ticks" role="img" aria-label={failed ? `Failed in ${failed} of 48 half-hour slots` : 'All checks passed'}>
      {(ticks || []).map((t, i) => <i key={i} className={['n', '', 's', 'd'][t]} />)}
    </div>
  );
}

export function Area({ title, summary, children }) {
  return (
    <section className="area">
      <div className="area-head"><h2>{title}</h2>{summary && <span className="sum">{summary}</span>}</div>
      {children}
    </section>
  );
}

export function Unavailable({ what, error }) {
  return <p className="note">{what} not available{error ? `: ${error}` : ''}.</p>;
}
