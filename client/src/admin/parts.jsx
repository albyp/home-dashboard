import { useRef, useState } from 'react';
import { navigate } from '../nav.js';

// ok | warn | bad | off | unknown. The shape differs too (circle, diamond, square),
// so status never relies on colour alone.
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

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function agoLabel(minutes) {
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} min ago` : `${h} h ago`;
}

// Percentage sparkline (0–100) with a crosshair and tooltip on hover or touch.
// `minutes` is the span the values cover, oldest first.
export function Spark({ values, label, minutes = 360 }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  if (!values || values.length < 2) return <div className="spark empty">Collecting history…</div>;

  const last = values.length - 1;
  const x = i => (i / last) * 100;
  const y = v => 54 - (clamp(v, 0, 100) / 100) * 50;
  const pts = values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`);
  const peak = Math.round(Math.max(...values));

  const pick = e => {
    const r = ref.current.getBoundingClientRect();
    setHover(clamp(Math.round(((e.clientX - r.left) / r.width) * last), 0, last));
  };

  return (
    <div className="spark">
      <div className="spark-plot" ref={ref} onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
      <svg viewBox="0 0 100 56" preserveAspectRatio="none" role="img" aria-label={`${label}: now ${Math.round(values[last])}%, peak ${peak}%`}>
        <line className="gridln" x1="0" y1={y(50)} x2="100" y2={y(50)} />
        <path className="area-fill" d={`M0,56 L${pts.join(' L')} L100,56 Z`} />
        <polyline className="ln" points={pts.join(' ')} />
        {hover != null && <line className="cross" x1={x(hover)} x2={x(hover)} y1="0" y2="56" />}
      </svg>
      {hover != null && (
        <>
          <span className="spark-dot" style={{ left: `${x(hover)}%`, top: `${(y(values[hover]) / 56) * 100}%` }} />
          <span className="spark-tip" style={{ left: `${clamp(x(hover), 14, 86)}%` }}>
            <b>{Math.round(values[hover])}%</b> · {agoLabel(((last - hover) / last) * minutes)}
          </span>
        </>
      )}
      </div>
      <div className="spark-axis"><span>{agoLabel(minutes)}</span><span>peak {peak}%</span><span>now</span></div>
    </div>
  );
}

// Ring gauge for a single share (0..max)
export function Ring({ value, max = 100, level = '', label, children }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const f = max ? clamp(value / max, 0, 1) : 0;
  return (
    <div className="ring">
      <svg viewBox="0 0 44 44" role="img" aria-label={label}>
        <circle className="ring-bg" cx="22" cy="22" r={r} />
        <circle className={`ring-fg ${level}`} cx="22" cy="22" r={r} strokeDasharray={`${(f * c).toFixed(2)} ${c.toFixed(2)}`} transform="rotate(-90 22 22)" />
      </svg>
      <div>{children}</div>
    </div>
  );
}

// 48 half-hour slots from Gatus: 0 no data, 1 ok, 2 slow, 3 failed
const TICK = [['n', 'no data'], ['', 'ok'], ['s', 'slow'], ['d', 'failed']];
export function Ticks({ ticks }) {
  const list = ticks || [];
  const failed = list.filter(t => t === 3).length;
  return (
    <div className="ticks" role="img" aria-label={failed ? `Failed in ${failed} of 48 half-hour slots` : 'All checks passed'}>
      {list.map((t, i) => {
        const hoursAgo = (list.length - 1 - i) / 2;
        return <i key={i} className={TICK[t]?.[0] ?? 'n'} title={`${hoursAgo ? `${hoursAgo} h ago` : 'last half hour'}: ${TICK[t]?.[1] ?? 'no data'}`} />;
      })}
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
