import fs from 'fs/promises';
import { cached } from '../lib/cache.js';

// Hangar: the voice-note pipeline on tiny (~/hangar, hangar.service). It
// transcribes and summarises iPhone voice notes on tiny's CPU and rocky's GPU,
// and rewrites data/status/status.json every 15 s (atomic replace). Only that
// status folder is mounted, read-only; it holds counts and states, never transcripts.
//
// sources.hangar.file   path inside the container (e.g. /hangar/status.json)

const DOWN_MS = 2 * 60 * 1000;        // status not rewritten for 2 min: Hangar is down
const STUCK_MS = 60 * 60 * 1000;      // queued work, nothing finished for 1 h: stuck

const ms = iso => (iso ? Date.parse(iso) : NaN);

// Pure: what's wrong, as { level, title, detail } items. Workers on machines
// that sleep on purpose (rocky) may queue while asleep; that is not a problem.
export function hangarIssues(s, { now = Date.now(), sleepy = [] } = {}) {
  const out = [];
  const updated = ms(s?.updated);
  if (!s || Number.isNaN(updated) || now - updated > DOWN_MS) {
    out.push({ level: 'bad', title: 'Hangar is down', detail: Number.isNaN(updated) ? 'no status yet' : `status not updated for ${Math.round((now - updated) / 60000)} min` });
    return out;
  }
  for (const [name, w] of Object.entries(s.workers || {})) {
    if (w.failed > 0) {
      out.push({ level: 'warn', title: `Hangar: ${w.failed} failed job${w.failed > 1 ? 's' : ''} on ${name}`, detail: w.last_error || 'see the Hangar logs' });
    }
    const finished = ms(w.last_finished);
    if (!sleepy.includes(name) && w.queued > 0 && (Number.isNaN(finished) || now - finished > STUCK_MS)) {
      out.push({ level: 'bad', title: `Hangar on ${name} is stuck`, detail: `${w.queued} queued, nothing finished ${Number.isNaN(finished) ? 'yet' : `for ${Math.round((now - finished) / 60000)} min`}` });
    }
  }
  return out;
}

function ago(iso) {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (Number.isNaN(s)) return '—';
  if (s < 60) return `${Math.max(s, 1)} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 48 * 3600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

// The Hangar page (service extras): what's wrong, workers, recordings,
// rocky's agent and the last recordings. Rows are { label, value, level }.
export function hangarExtras(h) {
  if (!h) return [{ title: 'Hangar', rows: [], empty: 'Not configured (sources.hangar)' }];
  if (h.error) return [{ title: 'Hangar', rows: [], empty: h.error }];
  const rec = h.recordings || {};
  const out = h.outputs || {};
  const pair = o => (o ? `${o.ok ?? 0} ok${o.failed ? ` · ${o.failed} failed` : ''}` : '—');
  return [
    ...(h.issues.length ? [{ title: "What's wrong", rows: h.issues.map(i => ({ label: i.title, value: i.detail, level: i.level })), empty: '' }] : []),
    {
      title: `Workers · ${h.mode || 'unknown'} mode`,
      rows: h.workers.flatMap(w => [
        {
          label: w.name,
          value: `${w.queued} queued · ${w.running} running · ${w.done} done · ${w.failed} failed`,
          level: w.failed ? 'warn' : w.queued && !w.running ? 'off' : 'ok'
        },
        ...(w.current ? [{ label: `${w.name} now`, value: String(w.current) }] : []),
        { label: `${w.name} last finished`, value: w.last_finished ? ago(w.last_finished) : 'never' },
        ...(w.last_error ? [{ label: `${w.name} last error`, value: String(w.last_error), level: 'bad' }] : [])
      ]),
      empty: 'No workers'
    },
    {
      title: 'Recordings',
      rows: [
        { label: 'Voice notes', value: String(rec.total ?? 0) },
        { label: 'Audio', value: `${rec.audio_minutes ?? 0} min` },
        { label: 'Latest', value: rec.latest || '—' },
        { label: 'Transcripts', value: pair(out.transcripts), level: out.transcripts?.failed ? 'warn' : undefined },
        { label: 'Summaries', value: pair(out.summaries), level: out.summaries?.failed ? 'warn' : undefined },
        { label: 'Status written', value: h.updated ? ago(h.updated) : 'never' }
      ],
      empty: ''
    },
    ...(h.rocky ? [{
      title: 'Rocky agent (GPU)',
      rows: [
        { label: 'State', value: [h.rocky.state, ...(h.rocky.reasons || [])].join(' · '), level: h.rocky.state === 'idle' ? 'ok' : h.rocky.state === 'busy' ? 'warn' : 'off' },
        { label: 'Since', value: h.rocky.since ? ago(h.rocky.since) : '—' }
      ],
      empty: ''
    }] : []),
    {
      title: 'Last recordings',
      rows: h.recent.map(r => {
        const runs = Object.values(r.runs || {});
        return {
          label: `${r.recorded} · ${r.duration_s ?? '?'} s`,
          value: Object.entries(r.runs || {}).map(([w, st]) => `${w} ${st}`).join(' · '),
          level: runs.includes('failed') ? 'bad' : runs.every(st => st === 'done') ? 'ok' : 'off'
        };
      }),
      empty: 'No recordings yet'
    }
  ];
}

// Sleepy machines from the hosts list, by name and Tailscale name
const sleepyNames = config => config.hosts.filter(h => h.sleeps).flatMap(h => [h.name, h.tailscale]).filter(Boolean);

export function hangar(config) {
  const src = config.sources.hangar;
  if (!src?.file) return null;
  return cached('hangar', async () => {
    let s;
    try {
      s = JSON.parse(await fs.readFile(src.file, 'utf8'));
    } catch (error) {
      throw new Error(error.code === 'ENOENT' ? 'no status file yet (is hangar.service running?)' : error.message);
    }
    const workers = Object.entries(s.workers || {}).map(([name, w]) => ({ name, ...w }));
    return {
      updated: s.updated || null,
      mode: s.mode || null,
      recordings: s.recordings || {},
      workers,
      outputs: s.outputs || {},
      rocky: s.rocky || null,
      recent: (s.recent || []).slice(0, 5),
      issues: hangarIssues(s, { sleepy: sleepyNames(config) })
    };
  }, 10 * 1000);
}
