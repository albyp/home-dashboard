import fs from 'fs/promises';
import { get } from '../lib/http.js';
import { cached } from '../lib/cache.js';

// Each host runs host-agent/health-check.sh on a timer. It writes one JSON file:
// { host, generatedAt, stats: {...}, disks: [...], checks: [...] }
// This host's file is mounted into the container; other hosts publish theirs
// with `tailscale serve` (tailnet only).
export function getAgent(host) {
  if (!host.agent) return null;
  return cached(`agent:${host.name}`, async () => {
    const data = /^https?:\/\//.test(host.agent)
      ? await get(host.agent, { timeout: 4000 })
      : JSON.parse(await fs.readFile(host.agent, 'utf8'));
    const ageMs = Date.now() - new Date(data.generatedAt).getTime();
    return { ...data, ageMinutes: Math.round(ageMs / 60000) };
  });
}
