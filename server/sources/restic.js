import fs from 'fs';
import path from 'path';

// Backups (restic). The backup job on this host (homelab stacks/backup/backup.sh)
// writes small status files into /var/lib/restic, mounted read-only at
// sources.restic.dir:
//   last.json   this host's last backup run  {ok, at, added}
//   check.json  last repository check        {ok, at, added}
//   repo.json   every snapshot in the repo (all machines), repo size, when read
// The dashboard never talks to the repository itself.
//
// sources.restic.maxHours sets how old each machine's newest snapshot may be
// before it's late, e.g. { tiny: 26, rocky-1: 50 } (rocky is off some nights).

function readJson(dir, name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  } catch {
    return null;
  }
}

const hoursSince = iso => (iso ? (Date.now() - Date.parse(iso)) / 3600000 : null);

export function getRestic(config) {
  const src = config.sources.restic;
  if (!src?.dir) return null;
  const repo = readJson(src.dir, 'repo.json');
  const last = readJson(src.dir, 'last.json');
  const check = readJson(src.dir, 'check.json');
  if (!repo && !last) return { error: `No backup status in ${src.dir} yet` };

  const maxHours = src.maxHours || {};
  // Newest first by real time: machines stamp snapshots in different time zones
  const snapshots = [...(repo?.snapshots || [])].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  const hosts = [...new Set([...Object.keys(maxHours), ...snapshots.map(s => s.host)])].map(host => {
    const latest = snapshots.find(s => s.host === host) || null;
    const age = hoursSince(latest?.time);
    const limit = maxHours[host] ?? 26;
    let level = 'ok';
    if (!latest) level = 'bad';
    else if (age > limit * 2) level = 'bad';
    else if (age > limit) level = 'warn';
    return {
      host,
      latest,
      ageHours: age != null ? Math.round(age * 10) / 10 : null,
      limitHours: limit,
      count: snapshots.filter(s => s.host === host).length,
      level
    };
  });

  return {
    readAt: repo?.updatedAt || null,
    repo: repo?.repo || null,
    lastRun: last,
    check,
    hosts,
    snapshots: snapshots.slice(0, 12)
  };
}
