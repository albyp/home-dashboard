import fs from 'fs/promises';

// Claude subscription usage (5-hour and weekly windows). The dashboard never holds a
// Claude login: scripts/claude-usage.py runs on the host (claude-usage.timer, every
// 5 minutes), renews the Claude Code login, and writes only the numbers to a file
// mounted read-only here. Both upstream endpoints are unofficial, so expect gaps.
const USAGE_FILE = () => process.env.CLAUDE_USAGE_FILE || '/claude-usage/usage.json';
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
  return { window: rule.label, remainingPct: 100 - w.utilization, resetsAt: w.resetsAt };
}

export async function getClaudeUsage() {
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(USAGE_FILE(), 'utf8'));
  } catch (error) {
    return { configured: false, error: error.code === 'ENOENT' ? 'no usage file yet' : error.message };
  }
  const windows = {
    fiveHour: windowOf(raw.five_hour),
    sevenDay: windowOf(raw.seven_day),
    sevenDayOpus: windowOf(raw.seven_day_opus)
  };
  const hasData = Boolean(windows.fiveHour || windows.sevenDay);
  if (!hasData) return { configured: true, reachable: false, error: raw.error || 'no usage data yet' };

  const old = !raw.fetched_at || Date.now() - new Date(raw.fetched_at).getTime() > STALE_MS;
  return {
    configured: true,
    reachable: true,
    fetchedAt: raw.fetched_at,
    stale: old || raw.ok === false,
    error: raw.ok === false ? raw.error : old ? 'not updated in 15+ minutes' : null,
    ...windows,
    nudges: [nudgeFor('five_hour', windows.fiveHour), nudgeFor('seven_day', windows.sevenDay)].filter(Boolean)
  };
}
