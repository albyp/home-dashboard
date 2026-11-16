import { loadConfig, allServices } from '../config.js';
import { getGatus, findCheck } from '../sources/gatus.js';
import { getAgent } from '../sources/agent.js';
import { getLocalStats } from '../sources/system.js';
import { getContainers } from '../sources/docker.js';
import { getTailscale } from '../sources/tailscale.js';
import { getSyncthing } from '../sources/syncthing.js';
import { getRepos } from '../sources/repos.js';
import { adguard, internet, jellyfinSessions, jellyfinAddedThisWeek, seerrRequests, arrDetails } from '../sources/apps.js';
import { humidors } from '../sources/homeassistant.js';
import { betbot } from '../sources/betbot.js';
import { claudeUsage } from '../sources/claude.js';
import { vaultToday } from '../sources/vault.js';

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
    for (const f of d.syncthing.folders) if (f.level !== 'ok') add(f.level, `Syncthing "${f.label}": ${f.state}`, f.devices.join(' · '), f.lastChange);
  }
  if (ok(d.home.humidors)) {
    for (const h of d.home.humidors.humidors) if (h.status.level !== 'ok') add(h.status.level, `Humidor ${h.name}: ${h.status.label}`, `${h.humidity}% · ${h.temperature} °C`, h.updated);
  }
  return out.sort((a, b) => RANK[b.level] - RANK[a.level]);
}

export async function adminSnapshot() {
  const config = loadConfig();
  const ts = await getTailscale(config);
  const [gatus, hosts, syncthing, repos, ag, net, sessions, added, requests, hum, bb, claude, vault] = await Promise.all([
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
    vaultToday(config)
  ]);

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
      tailscale: ok(ts) ? { online: ts.online, total: ts.total, exitNodes: ts.exitNodes } : null
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
