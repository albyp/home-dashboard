import { get } from '../lib/http.js';
import { cached } from '../lib/cache.js';

// Gatus is the check engine: it probes, keeps history and sends alerts.
// The dashboard reads its results so the page and the alerts always agree.
const SLOTS = 48; // half-hour slots over 24 h
const SLOT_MS = 30 * 60 * 1000;

function summarise(endpoint) {
  const results = endpoint.results || [];
  const last = results[results.length - 1] || null;
  const now = Date.now();

  // 0 = no data, 1 = all passed, 2 = slow/partial, 3 = failed
  const ticks = new Array(SLOTS).fill(0);
  for (const r of results) {
    const age = now - new Date(r.timestamp).getTime();
    if (age < 0 || age >= SLOTS * SLOT_MS) continue;
    const slot = SLOTS - 1 - Math.floor(age / SLOT_MS);
    const value = r.success ? 1 : 3;
    ticks[slot] = Math.max(ticks[slot], value);
  }

  const day = results.filter(r => now - new Date(r.timestamp).getTime() < 24 * 3600 * 1000);
  const uptime = day.length ? day.filter(r => r.success).length / day.length : null;
  const durations = day.filter(r => r.success).map(r => r.duration / 1e6).sort((a, b) => a - b);
  const median = durations.length ? Math.round(durations[Math.floor(durations.length / 2)]) : null;

  // When did the current failure start?
  let failingSince = null;
  if (last && !last.success) {
    for (let i = results.length - 1; i >= 0 && !results[i].success; i--) failingSince = results[i].timestamp;
  }
  const lastSuccess = [...results].reverse().find(r => r.success)?.timestamp || null;

  return {
    key: endpoint.key,
    name: endpoint.name,
    group: endpoint.group || null,
    status: !last ? 'unknown' : last.success ? 'ok' : 'bad',
    httpStatus: last?.status ?? null,
    responseMs: last ? Math.round(last.duration / 1e6) : null,
    errors: last?.errors || [],
    lastCheck: last?.timestamp || null,
    lastSuccess,
    failingSince,
    uptime24h: uptime,
    medianMs: median,
    ticks
  };
}

export function getGatus(config) {
  const src = config.sources.gatus;
  if (!src?.url) return null;
  return cached('gatus', async () => {
    const all = [];
    for (let page = 1; page <= 5; page++) {
      const batch = await get(`${src.url.replace(/\/$/, '')}/api/v1/endpoints/statuses?page=${page}&pageSize=100`);
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return { checks: all.map(summarise) };
  });
}

// Find a check by Gatus name (case-insensitive), optionally "group/name"
export function findCheck(gatus, name) {
  if (!gatus?.checks || !name) return null;
  const wanted = name.toLowerCase();
  return gatus.checks.find(c => c.name.toLowerCase() === wanted || `${c.group}/${c.name}`.toLowerCase() === wanted) || null;
}
