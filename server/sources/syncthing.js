import fs from 'fs';
import { get } from '../lib/http.js';
import { cached } from '../lib/cache.js';

let cachedKey = null;
function apiKey(src) {
  if (src.key) return src.key;
  if (cachedKey) return cachedKey;
  try {
    cachedKey = fs.readFileSync(src.config || '/syncthing/config.xml', 'utf8').match(/<apikey>([^<]+)<\/apikey>/)?.[1] || null;
  } catch (error) {
    console.warn('Syncthing config not readable:', error.message);
  }
  return cachedKey;
}

// Every folder, with the devices it is shared with and how far each one is
export function getSyncthing(config) {
  const src = config.sources.syncthing;
  if (!src?.url) return null;
  return cached('syncthing', async () => {
    const key = apiKey(src);
    if (!key) throw new Error('No Syncthing API key (mount config.xml or set sources.syncthing.key)');
    const base = src.url.replace(/\/$/, '');
    const st = path => get(`${base}${path}`, { headers: { 'X-API-Key': key }, timeout: 4000 }).catch(err => {
      if (err.status === 403) cachedKey = null;
      throw err;
    });

    const [folders, devices, connections, status, folderStats, deviceStats, pendingDevices, pendingFolders] = await Promise.all([
      st('/rest/config/folders'),
      st('/rest/config/devices'),
      st('/rest/system/connections'),
      st('/rest/system/status'),
      st('/rest/stats/folder'),
      st('/rest/stats/device').catch(() => ({})),
      st('/rest/cluster/pending/devices').catch(() => ({})),
      st('/rest/cluster/pending/folders').catch(() => ({}))
    ]);
    const myId = status.myID;
    const nameOf = id => devices.find(d => d.deviceID === id)?.name || id.slice(0, 7);
    // Devices on machines that sleep on purpose (hosts with sleeps: true): being away is normal
    const sleepy = new Set(config.hosts.filter(h => h.sleeps)
      .flatMap(h => [h.name, h.tailscale]).filter(Boolean).map(n => n.toLowerCase()));
    const peerIds = devices.map(d => d.deviceID).filter(id => id !== myId);
    const isOnline = id => !!connections.connections?.[id]?.connected;
    const lastSeen = id => realDate(deviceStats[id]?.lastSeen);
    // Phones and laptops come and go: offline for less than a day is normal
    const recentlySeen = id => {
      const t = lastSeen(id);
      return !!t && Date.now() - Date.parse(t) < STALE_MS;
    };

    const out = await Promise.all(folders.map(async folder => {
      const db = await st(`/rest/db/status?folder=${encodeURIComponent(folder.id)}`);
      const peers = await Promise.all(folder.devices.filter(d => d.deviceID !== myId).map(async ({ deviceID }) => {
        const connected = isOnline(deviceID);
        const sleeps = sleepy.has(nameOf(deviceID).toLowerCase());
        // Completion works for offline devices too: it is what they had when last seen
        const completion = await st(`/rest/db/completion?folder=${encodeURIComponent(folder.id)}&device=${deviceID}`).catch(() => null);
        return {
          name: nameOf(deviceID),
          connected,
          asleep: !connected && sleeps,
          away: !connected && !sleeps && recentlySeen(deviceID),
          lastSeen: connected ? null : lastSeen(deviceID),
          completion: completion ? Math.floor(completion.completion * 10) / 10 : null,
          needBytes: completion?.needBytes ?? null
        };
      }));

      let state = 'up to date';
      let level = 'ok';
      if (folder.paused) { state = 'paused'; level = 'warn'; }
      else if (db.errors > 0 || db.pullErrors > 0) { state = `${db.errors || db.pullErrors} errors`; level = 'bad'; }
      else if (db.state === 'syncing' || db.needFiles > 0) { state = 'syncing'; }
      else if (peers.length && peers.every(p => !p.connected && !p.asleep && !p.away)) { state = 'no devices online'; level = 'warn'; }
      else if (peers.some(p => !p.connected && !p.asleep && !p.away)) {
        const waiting = peers.filter(p => !p.connected && !p.asleep && !p.away).map(p => p.name).join(', ');
        state = `${waiting} not seen for over a day`;
        level = 'warn';
      } else if (peers.some(p => p.connected && p.completion != null && p.completion < 100)) { state = 'syncing'; }
      else if (peers.some(p => p.asleep || p.away)) { state = `up to date · ${peers.filter(p => p.asleep || p.away).map(p => p.name).join(', ')} offline`; }

      return {
        id: folder.id,
        label: folder.label || folder.id,
        devices: [nameOf(myId), ...peers.map(p => p.name)],
        peers,
        state,
        level,
        lastChange: realDate(folderStats[folder.id]?.lastFile?.at) || realDate(db.stateChanged),
        needBytes: peers.reduce((sum, p) => sum + (p.needBytes || 0), 0)
      };
    }));

    // Per device: online or when last seen, and how far behind it is across folders
    const deviceList = peerIds.map(id => {
      const name = nameOf(id);
      const inFolders = out.flatMap(f => f.peers.filter(p => p.name === name).map(p => ({ folder: f.label, ...p })));
      const connected = isOnline(id);
      const sleeps = sleepy.has(name.toLowerCase());
      return {
        name,
        connected,
        asleep: !connected && sleeps,
        stale: !connected && !sleeps && !recentlySeen(id),
        lastSeen: connected ? null : lastSeen(id),
        folders: inFolders.length,
        behind: inFolders.filter(p => p.completion != null && p.completion < 100)
          .map(p => ({ folder: p.folder, completion: p.completion, needBytes: p.needBytes }))
      };
    }).sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));

    // Devices and folders other machines offered that nobody accepted yet: gaps
    const pending = [
      ...Object.entries(pendingDevices || {}).map(([id, o]) => ({ kind: 'device', name: o.name || id.slice(0, 7), from: null, at: o.time })),
      ...Object.entries(pendingFolders || {}).flatMap(([id, f]) => Object.entries(f.offeredBy || {}).map(([dev, o]) => ({
        kind: 'folder', name: o.label || id, from: nameOf(dev), at: o.time
      })))
    ];

    return {
      thisDevice: nameOf(myId),
      devicesOnline: peerIds.filter(isOnline).length + 1,
      devicesAsleep: peerIds.filter(id => !isOnline(id) && sleepy.has(nameOf(id).toLowerCase())).map(nameOf),
      devicesTotal: peerIds.length + 1,
      devices: deviceList,
      pending,
      folders: out.sort((a, b) => a.label.localeCompare(b.label))
    };
  });
}

const STALE_MS = 24 * 3600 * 1000;

// Syncthing reports "never" as Go's zero time (0001-01-01) or the Unix epoch (1970).
function realDate(v) {
  return v && !/^(0001|1970)-/.test(String(v)) ? v : null;
}
