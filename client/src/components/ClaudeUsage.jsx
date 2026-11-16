import React from 'react';
import { SiClaude } from 'react-icons/si';
import { timeAgo } from '../format';

function untilText(iso) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'resetting now';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `resets in ${Math.floor(h / 24)}d ${h % 24}h`;
  return h ? `resets in ${h}h ${m}m` : `resets in ${m}m`;
}

function UsageBar({ label, w }) {
  if (!w) return null;
  const tone = w.utilization >= 90 ? 'red' : w.utilization >= 70 ? 'amber' : '';
  return (
    <div className="cu-row">
      <div className="cu-head">
        <span>{label}</span>
        <span className="muted">{w.utilization}% used · {untilText(w.resetsAt)}</span>
      </div>
      <div className="bar"><div className={`fill ${tone}`} style={{ width: `${Math.min(w.utilization, 100)}%` }} /></div>
    </div>
  );
}

// Claude subscription usage, with a nudge when a window is about to reset unused
export default function ClaudeUsage({ data }) {
  if (!data) return <section className="widget">Loading Claude usage...</section>;

  if (!data.configured) {
    return (
      <section className="widget claude-usage">
        <h2><span><SiClaude /> Claude usage</span></h2>
        <div className="muted">Not set up yet: log in to Claude Code on the server and enable <span className="mono">claude-usage.timer</span>.</div>
      </section>
    );
  }
  if (!data.reachable) {
    return (
      <section className="widget claude-usage">
        <h2><span><SiClaude /> Claude usage</span></h2>
        <div className="widget-error">{data.error}</div>
      </section>
    );
  }

  return (
    <section className="widget claude-usage">
      <h2>
        <span><SiClaude /> Claude usage</span>
        <span className="h2-meta">{data.stale ? `stale · ${data.error}` : `checked ${timeAgo(data.fetchedAt)}`}</span>
      </h2>
      {data.nudges.map(n => (
        <div key={n.window} className="cu-nudge">
          Get busy: {n.remainingPct}% of your {n.window} limit is unused and it {untilText(n.resetsAt)}.
        </div>
      ))}
      <UsageBar label="5-hour" w={data.fiveHour} />
      <UsageBar label="Weekly" w={data.sevenDay} />
      <UsageBar label="Weekly (Opus)" w={data.sevenDayOpus} />
    </section>
  );
}
