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

    const [folders, devices, connections, status, folderStats] = await Promise.all([
      st('/rest/config/folders'),
      st('/rest/config/devices'),
      st('/rest/system/connections'),
      st('/rest/system/status'),
      st('/rest/stats/folder')
    ]);
    const myId = status.myID;
    const nameOf = id => devices.find(d => d.deviceID === id)?.name || id.slice(0, 7);
    const peerIds = devices.map(d => d.deviceID).filter(id => id !== myId);

    const out = await Promise.all(folders.map(async folder => {
      const db = await st(`/rest/db/status?folder=${encodeURIComponent(folder.id)}`);
      const peers = await Promise.all(folder.devices.filter(d => d.deviceID !== myId).map(async ({ deviceID }) => {
        const connected = !!connections.connections?.[deviceID]?.connected;
        const completion = connected
          ? await st(`/rest/db/completion?folder=${encodeURIComponent(folder.id)}&device=${deviceID}`).catch(() => null)
          : null;
        return {
          name: nameOf(deviceID),
          connected,
          completion: completion ? Math.floor(completion.completion * 10) / 10 : null,
          needBytes: completion?.needBytes ?? null
        };
      }));

      let state = 'up to date';
      let level = 'ok';
      if (folder.paused) { state = 'paused'; level = 'warn'; }
      else if (db.errors > 0 || db.pullErrors > 0) { state = `${db.errors || db.pullErrors} errors`; level = 'bad'; }
      else if (db.state === 'syncing' || db.needFiles > 0) { state = 'syncing'; }
      else if (peers.length && peers.every(p => !p.connected)) { state = 'no devices online'; level = 'warn'; }
      else if (peers.some(p => !p.connected)) {
        const waiting = peers.filter(p => !p.connected).map(p => p.name).join(', ');
        state = `waiting for ${waiting}`;
        level = 'warn';
      } else if (peers.some(p => p.completion != null && p.completion < 100)) { state = 'syncing'; }

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

    return {
      thisDevice: nameOf(myId),
      devicesOnline: peerIds.filter(id => connections.connections?.[id]?.connected).length + 1,
      devicesTotal: peerIds.length + 1,
      folders: out.sort((a, b) => a.label.localeCompare(b.label))
    };
  });
}

// Syncthing reports "never" as Go's zero time (0001-01-01).
function realDate(v) {
  return v && !String(v).startsWith('0001-') ? v : null;
}
