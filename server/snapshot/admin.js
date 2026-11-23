import { loadConfig, allServices } from '../config.js';
import { getGatus, findCheck } from '../sources/gatus.js';
import { getAgent } from '../sources/agent.js';
import { getLocalStats } from '../sources/system.js';
import { getContainers } from '../sources/docker.js';
import { getTailscale } from '../sources/tailscale.js';
import { getSyncthing } from '../sources/syncthing.js';
import { getRepos } from '../sources/repos.js';
import { adguard, internet, jellyfinSessions, jellyfinAddedThisWeek, seerrRequests, arrDetails, qbittorrent, vpn } from '../sources/apps.js';
import { humidors } from '../sources/homeassistant.js';
import { betbot } from '../sources/betbot.js';
import { claudeUsage } from '../sources/claude.js';
import { vaultToday } from '../sources/vault.js';
import { solar } from '../sources/solar.js';

const ok = v => v && !v.error;
const RANK = { bad: 3, warn: 2, unknown: 1, ok: 0 };

async function hostTile(config, host, ts) {
  const isLocal = host.name === config.host;
  const [agent, local, containers] = await Promise.all([
    getAgent(host),
    isLocal ? getLocalStats() : null,
    getContainers(host)
  ]);
  const node = ts?.nodes?.find(n => n.name === (host.tailscale || host.name).toLowerCase());
  const agentFresh = ok(agent) && agent.ageMinutes <= 15;
  // true / false, or null when nothing can tell us (no agent, Tailscale or Docker)
  let online = null;
  if (isLocal || agentFresh) online = true;
  else if (node) online = node.online;
  else if (containers) online = ok(containers);
  else if (agent) online = false;

  const stats = ok(local) ? local : agentFresh ? agent.stats : null;
  const rootDisk = ok(agent) ? (agent.disks || []).find(d => d.mount === '/') : null;
  return {
    name: host.name,
    model: host.model || null,
    sleeps: host.sleeps,
    online,
    lastSeen: online ? null : node?.lastSeen || (ok(agent) ? agent.generatedAt : null),
    cpu: stats?.cpu ?? null,
    ram: stats?.ram || null,
    temp: stats?.temp ?? null,
    uptime: stats?.uptime ?? null,
    diskPercent: rootDisk ? Math.round((rootDisk.used / rootDisk.total) * 100) : null,
    cpuHistory: ok(local) ? local.cpuHistory : agent?.stats?.cpuHistory || [],
    containers: ok(containers) ? { running: containers.filter(c => c.state === 'running').length, total: containers.length } : null,
    agent,
    containerList: ok(containers) ? containers : null
  };
}

function serviceStatus(svc, gatus, hosts) {
  const check = findCheck(gatus, svc.check);
  const host = hosts.find(h => h.name === svc.host);
  // A service on a machine that sleeps on purpose (rocky) is just off while it sleeps
  if (host?.sleeps && host.online === false) return { status: 'off', check };
  if (check) return { status: check.status, check };
  const container = svc.container && host?.containerList?.find(c => c.name === svc.container);
  if (container) return { status: container.state === 'running' && container.health !== 'unhealthy' ? 'ok' : 'bad', check: null };
  if (host && host.online === false) return { status: 'off', check: null };
  return { status: 'unknown', check: null };
}

function problems(config, d) {
  const out = [];
  const add = (level, title, detail, since, link) => out.push({ level, title, detail, since, link });

  for (const s of d.services) {
    if (s.status === 'bad') {
      const c = s.check;
      const why = c?.httpStatus ? `HTTP ${c.httpStatus}` : c?.errors?.[0] || 'check failing';
      add('bad', `${s.name} is failing its check`, why, c?.failingSince || null, `/s/${s.id}`);
    }
  }
  for (const h of d.hosts) {
    // A machine that sleeps on purpose (rocky) being off is normal: its tile says so, it is not a problem
    if (h.online === false && !h.sleeps) add('bad', `${h.name} is offline`, 'not answering', h.lastSeen);
    if (h.online === null) add('warn', `No data from ${h.name}`, 'its host agent, Tailscale and Docker are not reachable', null);
    const agent = h.agent;
    if (ok(agent) && agent.ageMinutes > 30 && h.online) add('warn', `${h.name} health report is stale`, `last report ${agent.ageMinutes} min ago`, agent.generatedAt);
  }
  for (const disk of d.storage.disks) {
    if (disk.percent >= config.thresholds.diskBad) add('bad', `${disk.label} is ${disk.percent}% full`, disk.host, null);
    else if (disk.percent >= config.thresholds.diskWarn) add('warn', `${disk.label} is ${disk.percent}% full`, disk.host, null);
  }
  for (const c of d.health) {
    if (c.level === 'bad' || c.level === 'warn') add(c.level, `${c.host}: ${c.name}`, c.result + (c.detail ? ` · ${c.detail}` : ''), c.lastRun);
  }
  if (Array.isArray(d.repos)) {
    const flagged = d.repos.filter(r => r.level === 'warn');
    if (flagged.length) add('warn', `${flagged[0].name}: ${flagged[0].state.toLowerCase()}`, flagged.slice(1).map(r => `${r.name}: ${r.state.toLowerCase()}`).join(' · ') || 'repos', null);
  }
  if (ok(d.syncthing)) {
    for (const f of d.syncthing.folders) if (f.level !== 'ok') add(f.level, `Syncthing "${f.label}": ${f.state}`, f.devices.join(' · '), f.lastChange, '/s/syncthing');
    for (const p of d.syncthing.pending || []) {
      add('warn', p.kind === 'device' ? `Syncthing: ${p.name} wants to connect` : `Syncthing: ${p.from} offers folder "${p.name}"`,
        'not accepted yet', p.at, '/s/syncthing');
    }
  }
  // The torrent VPN: skipped while its machine is asleep (the client is off too)
  const v = d.network.vpn;
  if (v && !v.asleep) {
    if (v.error) add('warn', 'Torrent VPN not reachable', v.error, null, v.link);
    else if (v.leak) add('bad', 'Torrents are NOT on the VPN', `exit IP ${v.exitIp} is the home connection`, null, v.link);
    else if (!v.running) add('bad', 'Torrent VPN is down', 'torrents have no network until it reconnects (kill switch)', null, v.link);
  }
  if (ok(d.home.humidors)) {
    for (const h of d.home.humidors.humidors) if (h.status.level !== 'ok') add(h.status.level, `Humidor ${h.name}: ${h.status.label}`, `${h.humidity}% · ${h.temperature} °C`, h.updated);
  }
  return out.sort((a, b) => RANK[b.level] - RANK[a.level]);
}

export async function adminSnapshot() {
  const config = loadConfig();
  const ts = await getTailscale(config);
  const [gatus, hosts, syncthing, repos, ag, net, sessions, added, requests, hum, bb, claude, vault, sun, tunnel] = await Promise.all([
    getGatus(config),
    Promise.all(config.hosts.map(h => hostTile(config, h, ts))),
    getSyncthing(config),
    getRepos(config),
    adguard(config),
    internet(),
    jellyfinSessions(config),
    jellyfinAddedThisWeek(config),
    seerrRequests(config),
    humidors(config),
    betbot(config),
    claudeUsage(config),
    vaultToday(config),
    solar(config),
    vpn(config)
  ]);
  const vpnHost = hosts.find(h => h.name === config.sources.vpn?.host);
  const vpnSvc = allServices(config).find(s => s.type === 'qbittorrent');
  const vpnInfo = tunnel ? {
    ...(ok(tunnel) ? tunnel : { error: tunnel.error }),
    asleep: !!(vpnHost?.sleeps && vpnHost.online === false),
    link: vpnSvc ? `/s/${vpnSvc.id}` : null
  } : null;

  const services = allServices(config).map(svc => {
    const { status, check } = serviceStatus(svc, gatus, hosts);
    return { id: svc.id, kind: svc.kind, name: svc.name, host: svc.host, url: svc.url, status, check };
  });

  const disks = hosts.flatMap(h => ok(h.agent) ? (h.agent.disks || []).map(dk => ({
    host: h.name,
    label: `${h.name} · ${dk.label || dk.mount}`,
    used: dk.used,
    total: dk.total,
    percent: Math.round((dk.used / dk.total) * 100)
  })) : []);
  const health = hosts.flatMap(h => ok(h.agent) ? (h.agent.checks || []).map(c => ({ ...c, host: h.name })) : []);
  const backupCheck = health.find(c => c.id === 'restic-backup');

  const checks = ok(gatus) ? gatus.checks : null;
  const weekUptime = checks?.length
    ? checks.filter(c => c.uptime24h != null).reduce((s, c, _, a) => s + c.uptime24h / a.length, 0)
    : null;

  const d = {
    services,
    hosts: hosts.map(({ agent, containerList, ...h }) => h),
    network: {
      internet: ok(net) ? net : null,
      adguard: ok(ag) ? ag : ag ? { error: ag.error } : null,
      tailscale: ok(ts) ? { online: ts.online, total: ts.total, exitNodes: ts.exitNodes } : null,
      vpn: vpnInfo
    },
    storage: { disks, backup: backupCheck || null },
    health,
    repos,
    syncthing,
    // Checks that belong to a sidebar service first, then any other Gatus checks
    checks: checks
      ? [
        ...services.filter(s => s.check).map(s => ({ ...s.check, status: s.status === 'off' ? 'off' : s.check.status, serviceId: s.id, host: s.host, display: s.name })),
        ...checks.filter(c => !services.some(s => s.check?.key === c.key)).map(c => ({ ...c, serviceId: null, host: null, display: c.name }))
      ]
      : gatus,
    home: { humidors: hum, betbot: bb },
    claude,
    vault,
    solar: sun,
    today: {
      streams: ok(sessions) ? sessions : null,
      requests: ok(requests) ? { pending: requests.pending } : null,
      added: ok(added) ? added : null,
      uptime: weekUptime
    }
  };
  return {
    generatedAt: new Date().toISOString(),
    title: config.title,
    host: config.host,
    problems: problems(config, { ...d, hosts }),
    sidebar: {
      apps: services.filter(s => s.kind === 'app').map(({ check, ...s }) => s),
      tools: services.filter(s => s.kind === 'tool').map(({ check, ...s }) => s)
    },
    ...d,
    services: undefined
  };
}

// "3 h ago" style, for last-seen times
function ago(iso) {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${Math.max(m, 1)} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}
const size = b => (b >= 2 ** 30 ? `${(b / 2 ** 30).toFixed(1)} GB` : b >= 2 ** 20 ? `${Math.round(b / 2 ** 20)} MB` : `${Math.max(1, Math.round((b || 0) / 1024))} KB`);
const speed = b => (b >= 2 ** 20 ? `${(b / 2 ** 20).toFixed(1)} MB/s` : `${Math.round((b || 0) / 1024)} KB/s`);

// Syncthing page: who is online, who is behind, every folder per device, and
// anything offered that nobody accepted yet
function syncthingExtras(s, ts) {
  if (!ok(s)) return [{ title: 'Syncthing', rows: [], empty: s?.error || 'Not configured' }];
  // A "sleepy" machine that is actually awake on Tailscale but not in Syncthing:
  // its Syncthing isn't running, which is worth knowing
  const awake = name => ok(ts) && ts.nodes?.some(n => n.online && n.name === hostOf(name));
  const hostOf = name => (s.hostNames?.[name] || name).toLowerCase();
  const seen = t => (t ? `seen ${ago(t)}` : 'never connected');
  const deviceRow = d => {
    const behind = d.behind.length ? ` · behind in ${d.behind.length} folder${d.behind.length > 1 ? 's' : ''}` : '';
    if (d.connected) return { label: d.name, value: `online${behind}`, level: d.behind.length ? 'warn' : 'ok' };
    if (d.asleep && awake(d.name)) return { label: d.name, value: `machine is on, Syncthing isn't running · ${seen(d.lastSeen)}`, level: 'warn' };
    if (d.asleep) return { label: d.name, value: `asleep · ${seen(d.lastSeen)}${behind}`, level: 'off' };
    return { label: d.name, value: `offline · ${seen(d.lastSeen)}${behind}`, level: d.stale ? 'warn' : 'off' };
  };
  const peerRow = p => {
    const pct = p.completion != null && p.completion < 100 ? `${p.completion}% · ${size(p.needBytes)} behind` : 'up to date';
    if (p.connected) return { label: p.name, value: pct, level: pct === 'up to date' ? 'ok' : 'warn' };
    if (!p.lastSeen) return { label: p.name, value: 'never connected to this machine', level: 'warn' };
    const was = p.completion != null ? (p.completion < 100 ? `, was ${p.completion}%` : ', was up to date') : '';
    const sleeping = p.asleep && !awake(p.name);
    return { label: p.name, value: `${sleeping ? 'asleep' : 'offline'} · ${seen(p.lastSeen)}${was}`, level: sleeping || p.away ? 'off' : 'warn' };
  };
  return [
    { title: `Devices · ${s.devicesOnline} of ${s.devicesTotal} online`, rows: s.devices.map(deviceRow), empty: 'No other devices' },
    ...(s.pending?.length ? [{
      title: 'Waiting to be accepted',
      rows: s.pending.map(p => ({ label: p.kind === 'device' ? `Device ${p.name}` : `Folder "${p.name}" from ${p.from}`, value: ago(p.at), level: 'warn' })),
      empty: ''
    }] : []),
    ...s.folders.map(f => ({
      title: `${f.label} · ${f.state}`,
      rows: f.peers.map(peerRow),
      empty: 'Not shared with any other device'
    }))
  ];
}

// qBittorrent page: the VPN it runs behind, and what it is doing
async function torrentExtras(config) {
  const [t, v] = await Promise.all([qbittorrent(config), vpn(config)]);
  const out = [];
  if (v) {
    out.push(ok(v) ? {
      title: 'VPN (kill switch)',
      rows: [
        { label: 'Tunnel', value: v.running ? 'up' : 'down: torrents have no network', level: v.running ? 'ok' : 'bad' },
        { label: 'Exit', value: [v.city, v.country].filter(Boolean).join(', ') || '—', level: v.leak ? 'bad' : 'ok' },
        { label: 'Exit IP', value: v.exitIp || '—' },
        { label: 'Network', value: [v.provider, v.org].filter(Boolean).join(' · ') || '—' },
        { label: 'Home IP hidden', value: !v.homeChecked ? 'could not check' : v.leak ? 'NO: traffic leaves from home' : 'yes', level: !v.homeChecked ? 'unknown' : v.leak ? 'bad' : 'ok' }
      ],
      empty: ''
    } : { title: 'VPN (kill switch)', rows: [], empty: `Not reachable: ${v.error}` });
  }
  if (t) {
    out.push(ok(t) ? {
      title: 'Transfers',
      rows: [
        { label: 'Connection', value: t.connection, level: t.connection === 'disconnected' ? 'bad' : t.connection === 'firewalled' ? 'warn' : 'ok' },
        { label: 'Down / up', value: `${speed(t.downSpeed)} / ${speed(t.upSpeed)}` },
        { label: 'Downloading', value: String(t.downloading) },
        { label: 'Seeding', value: String(t.seeding) },
        { label: 'Active now', value: String(t.active) },
        ...(t.errored ? [{ label: 'Errors', value: `${t.errored} (missing files or errored)`, level: 'bad' }] : []),
        { label: 'DHT nodes', value: String(t.dhtNodes) }
      ],
      empty: ''
    } : { title: 'Transfers', rows: [], empty: `Not reachable: ${t.error}` });
  }
  return out.length ? out : null;
}

export async function serviceSnapshot(id) {
  const config = loadConfig();
  const svc = allServices(config).find(s => s.id === id);
  if (!svc) return null;
  const gatus = await getGatus(config);
  const check = findCheck(gatus, svc.check);
  const host = config.hosts.find(h => h.name === svc.host);
  const containers = host ? await getContainers(host) : null;
  const container = ok(containers) && svc.container ? containers.find(c => c.name === svc.container) || null : null;

  let extras = null;
  try {
    if (svc.type === 'sonarr' || svc.type === 'radarr') extras = await arrDetails(config, svc.type);
    if (svc.type === 'seerr') {
      const r = await seerrRequests(config);
      if (ok(r)) extras = [{ title: 'Latest requests', rows: r.items.map(i => ({ label: i.title, value: i.status })), empty: 'No requests' }];
    }
    if (svc.type === 'adguard') {
      const a = await adguard(config);
      if (ok(a)) extras = [
        { title: 'Top clients', rows: a.topClients.map(c => ({ label: c.name, value: c.count.toLocaleString('en-AU') })), empty: 'No queries' },
        { title: 'Most blocked', rows: a.topBlocked.map(c => ({ label: c.name, value: c.count.toLocaleString('en-AU') })), empty: 'Nothing blocked' }
      ];
    }
    if (svc.type === 'syncthing') {
      const [s, ts] = await Promise.all([getSyncthing(config), getTailscale(config)]);
      // Syncthing device name -> Tailscale name, from the hosts list (rocky -> rocky-1)
      if (ok(s)) s.hostNames = Object.fromEntries(config.hosts.map(h => [h.name, h.tailscale || h.name]));
      extras = syncthingExtras(s, ts);
    }
    if (svc.type === 'qbittorrent') extras = await torrentExtras(config);
    if (svc.type === 'jellyfin') {
      const j = await jellyfinSessions(config);
      if (ok(j)) extras = [{ title: 'Watching now', rows: j.items.map(i => ({ label: i.title, value: i.device })), empty: 'Nobody is watching' }];
    }
    if (extras?.error) extras = [{ title: 'Details', rows: [], empty: extras.error }];
  } catch (error) {
    extras = [{ title: 'Details', rows: [], empty: error.message }];
  }

  return {
    generatedAt: new Date().toISOString(),
    service: { ...svc, key: undefined, api: undefined },
    status: check ? check.status : container ? (container.state === 'running' ? 'ok' : 'bad') : 'unknown',
    check,
    container,
    extras
  };
}
