import fs from 'fs/promises';
import { cached } from '../lib/cache.js';

// Claude subscription usage (5-hour and weekly windows). The dashboard holds no Claude
// login: host-agent/claude-usage.py (claude-usage.timer, every 5 minutes) renews the
// Claude Code login on the host and writes only the numbers to a file mounted here.
// Both upstream endpoints are unofficial, so a gap shows as "stale", not an error page.
const STALE_MS = 15 * 60 * 1000;

// Nudge when a window is close to resetting but much of it is still unused
const NUDGES = {
  five_hour: { label: '5-hour', withinMs: 60 * 60 * 1000, belowPct: 50 },
  seven_day: { label: 'weekly', withinMs: 24 * 60 * 60 * 1000, belowPct: 60 }
};

function windowOf(w) {
  if (!w || typeof w.utilization !== 'number') return null;
  return { utilization: Math.round(w.utilization), resetsAt: w.resets_at || null };
}

function nudgeFor(key, w) {
  const rule = NUDGES[key];
  if (!rule || !w?.resetsAt) return null;
  const msLeft = new Date(w.resetsAt).getTime() - Date.now();
  if (msLeft <= 0 || msLeft > rule.withinMs || w.utilization >= rule.belowPct) return null;
  return { window: rule.label, unusedPct: 100 - w.utilization, resetsAt: w.resetsAt };
}

// Admin overview only. Never sent to the kiosk.
export function claudeUsage(config) {
  const src = config.sources.claude;
  if (!src?.file) return null;
  return cached('claude', async () => {
    let raw;
    try {
      raw = JSON.parse(await fs.readFile(src.file, 'utf8'));
    } catch (error) {
      throw new Error(error.code === 'ENOENT' ? 'no usage file yet (claude-usage.timer)' : error.message);
    }
    const fiveHour = windowOf(raw.five_hour);
    const sevenDay = windowOf(raw.seven_day);
    if (!fiveHour && !sevenDay) throw new Error(raw.error || 'no usage data yet');

    const old = !raw.fetched_at || Date.now() - new Date(raw.fetched_at).getTime() > STALE_MS;
    return {
      fetchedAt: raw.fetched_at,
      stale: old || raw.ok === false ? (raw.ok === false ? raw.error : 'not updated in 15+ minutes') : null,
      fiveHour,
      sevenDay,
      sevenDayOpus: windowOf(raw.seven_day_opus),
      nudges: [nudgeFor('five_hour', fiveHour), nudgeFor('seven_day', sevenDay)].filter(Boolean)
    };
  }, 60 * 1000);
}
