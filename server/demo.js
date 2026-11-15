// Example data for DEMO=1 (local development without the homelab).
// Shapes match the real snapshots in snapshot/*.js. All figures are made up.
const MIN = 60000;
const HOUR = 60 * MIN;
const ago = ms => new Date(Date.now() - ms).toISOString();
const GB = 1024 ** 3;

function ticks(down = [], slow = []) {
  return Array.from({ length: 48 }, (_, i) => (down.includes(i) ? 3 : slow.includes(i) ? 2 : 1));
}

function check(name, { status = 'ok', ms = 30, uptime = 1, down = [], slow = [], http = 200, failingFor = 0 } = {}) {
  return {
    key: `apps_${name.toLowerCase().replace(/\W+/g, '-')}`,
    name,
    group: 'apps',
    status,
    httpStatus: http,
    responseMs: ms,
    errors: status === 'bad' ? [`HTTP ${http}`] : [],
    lastCheck: ago(40000),
    lastSuccess: status === 'ok' ? ago(40000) : ago(failingFor + MIN),
    failingSince: status === 'bad' ? ago(failingFor) : null,
    uptime24h: uptime,
    medianMs: ms,
    ticks: ticks(down, slow)
  };
}

const SERVICES = [
  ['jellyfin', 'app', 'Jellyfin', check('Jellyfin', { ms: 38 })],
  ['seerr', 'app', 'Seerr', check('Seerr', { ms: 64, slow: [31] })],
  ['home-assistant', 'app', 'Home Assistant', check('Home Assistant', { ms: 22 })],
  ['tandoor', 'app', 'Tandoor', check('Tandoor', { ms: 91 })],
  ['actual-budget', 'app', 'Actual Budget', check('Actual Budget', { ms: 17 })],
  ['adguard-home', 'tool', 'AdGuard Home', check('AdGuard Home', { ms: 11 })],
  ['sonarr', 'tool', 'Sonarr', check('Sonarr', { status: 'bad', http: 502, ms: 12, uptime: 0.989, down: [47], failingFor: 14 * MIN })],
  ['radarr', 'tool', 'Radarr', check('Radarr', { ms: 29 })],
  ['prowlarr', 'tool', 'Prowlarr', check('Prowlarr', { ms: 33 })],
  ['qbittorrent', 'tool', 'qBittorrent', check('qBittorrent', { ms: 44, uptime: 0.996, down: [12] })],
  ['syncthing', 'tool', 'Syncthing', check('Syncthing', { ms: 9 })],
  ['gatus', 'tool', 'Gatus', check('Gatus', { ms: 4 })]
].map(([id, kind, name, c]) => ({ id, kind, name, host: id === 'adguard-home' ? 'tiny' : 'tiny', url: '#', status: c.status, check: c }));

const cpuHistory = [28, 27, 24, 26, 20, 23, 12, 18, 22, 25, 21, 24, 26, 25, 22, 19, 17, 20, 23, 21, 18, 16, 14, 12]
  .map(v => 40 - v);

export function admin() {
  const services = SERVICES;
  return {
    demo: true,
    generatedAt: new Date().toISOString(),
    title: 'home-dashboard',
    host: 'tiny',
    problems: [
      { level: 'bad', title: 'Sonarr is failing its check', detail: 'HTTP 502 · Telegram alert sent', since: ago(14 * MIN), link: '/s/sonarr' },
      { level: 'warn', title: 'tiny · /srv/media is 87% full', detail: 'tiny', since: null },
      { level: 'warn', title: 'tiny: OS updates', detail: 'Reboot needed · kernel 6.8.0-49 installed', since: ago(5 * HOUR) },
      { level: 'warn', title: 'homelab: 2 to push', detail: 'betbot: 1 uncommitted', since: null },
      { level: 'warn', title: 'rocky is offline', detail: 'expected when the machine sleeps', since: ago(9 * HOUR) },
      { level: 'warn', title: 'Syncthing "rocky-backup": waiting for rocky', detail: 'tiny · rocky', since: ago(9 * HOUR) }
    ],
    sidebar: {
      apps: services.filter(s => s.kind === 'app').map(({ check, ...s }) => s),
      tools: services.filter(s => s.kind === 'tool').map(({ check, ...s }) => s)
    },
    hosts: [
      { name: 'tiny', model: 'Lenovo M920q · i7-8700T', online: true, cpu: 12, ram: { used: 9.8 * GB, total: 16 * GB }, temp: 41, uptime: 9 * 86400, diskPercent: 55, cpuHistory, containers: { running: 24, total: 25 } },
      { name: 'raspi', model: 'Raspberry Pi 4', online: true, cpu: 6, ram: { used: 1.1 * GB, total: 3.7 * GB }, temp: 48, uptime: 31 * 86400, diskPercent: 65, cpuHistory: cpuHistory.map(v => Math.max(2, v / 4)), containers: { running: 3, total: 3 } },
      { name: 'rocky', model: 'WSL2 on the desktop PC', sleeps: true, online: false, lastSeen: ago(9 * HOUR), cpu: null, ram: null, temp: null, uptime: null, diskPercent: null, cpuHistory: [], containers: null }
    ],
    network: {
      internet: { up: true, latencyMs: 9 },
      adguard: { queries: 18402, blockedPercent: 21.4, topClient: 'living-room-tv' },
      tailscale: { online: 5, total: 7, exitNodes: ['raspi'] }
    },
    storage: {
      disks: [
        { host: 'tiny', label: 'tiny · NVMe', used: 141 * GB, total: 256 * GB, percent: 55 },
        { host: 'tiny', label: 'tiny · /srv/media', used: 3480 * GB, total: 4000 * GB, percent: 87 },
        { host: 'raspi', label: 'raspi · SD card', used: 38 * GB, total: 58 * GB, percent: 65 }
      ],
      backup: { id: 'restic-backup', name: 'restic backup', host: 'tiny', level: 'ok', result: 'OK', detail: '+2.1 GB', lastRun: ago(7 * HOUR) }
    },
    health: [
      { id: 'smart-nvme0n1', name: 'SMART self-test · nvme0n1', host: 'tiny', lastRun: ago(4 * 86400000), level: 'ok', result: 'Passed', detail: 'wear 4% · 38 °C' },
      { id: 'smart-sda', name: 'SMART self-test · sda (media)', host: 'tiny', lastRun: ago(6 * HOUR), level: 'ok', result: 'Passed', detail: '0 reallocated · 34 °C' },
      { id: 'fsck', name: 'Filesystem check at boot', host: 'tiny', lastRun: ago(9 * 86400000), level: 'ok', result: 'Clean', detail: 'ext4 · 2 volumes' },
      { id: 'kernel-disk-errors', name: 'Disk errors (kernel log)', host: 'raspi', lastRun: ago(5 * MIN), level: 'ok', result: 'None', detail: 'last 7 days' },
      { id: 'throttling', name: 'Undervoltage / throttling', host: 'raspi', lastRun: ago(5 * MIN), level: 'ok', result: 'None', detail: 'since boot' },
      { id: 'restic-check', name: 'restic repository check', host: 'tiny', lastRun: ago(3 * 86400000), level: 'ok', result: 'OK', detail: '5% of data read' },
      { id: 'systemd-failed', name: 'Failed systemd units', host: 'tiny', lastRun: ago(MIN), level: 'ok', result: '0', detail: '' },
      { id: 'os-updates', name: 'OS updates', host: 'tiny', lastRun: ago(5 * HOUR), level: 'warn', result: 'Reboot needed', detail: 'kernel 6.8.0-49 installed' },
      { id: 'tls-cert', name: 'HTTPS certificate', host: 'tiny', lastRun: ago(2 * HOUR), level: 'ok', result: 'Valid', detail: 'expires in 62 d' }
    ],
    repos: [
      { name: 'home-dashboard', branch: 'revamp', lastPush: ago(20 * MIN), dirty: 0, ahead: 0, state: 'Up to date', level: 'ok' },
      { name: 'homelab', branch: 'main', lastPush: ago(2 * 86400000), dirty: 0, ahead: 2, state: '2 to push', level: 'warn' },
      { name: 'dotfiles', branch: 'main', lastPush: ago(8 * 86400000), dirty: 0, ahead: 0, state: 'Up to date', level: 'ok' },
      { name: 'betbot', branch: 'linux-port', lastPush: ago(6 * 86400000), dirty: 1, ahead: 0, state: '1 uncommitted', level: 'warn' }
    ],
    syncthing: {
      thisDevice: 'tiny',
      devicesOnline: 2,
      devicesTotal: 3,
      folders: [
        { id: 'albyte', label: 'Albyte', devices: ['tiny', 'rocky', 'BMS0090'], state: 'up to date', level: 'ok', lastChange: ago(4 * MIN), needBytes: 0 },
        { id: 'appdata', label: 'appdata-backup', devices: ['tiny'], state: 'up to date', level: 'ok', lastChange: ago(7 * HOUR), needBytes: 0 },
        { id: 'rocky-backup', label: 'rocky-backup', devices: ['tiny', 'rocky'], state: 'waiting for rocky', level: 'warn', lastChange: ago(9 * HOUR), needBytes: 1.4 * GB },
        { id: 'secrets', label: 'secrets', devices: ['tiny', 'rocky'], state: 'up to date', level: 'ok', lastChange: ago(3 * 86400000), needBytes: 0 }
      ]
    },
    checks: services.map(s => ({ ...s.check, serviceId: s.id, host: s.host, display: s.name })),
    home: {
      humidors: {
        limits: { humidity: [65, 70], temperature: [16, 21] },
        humidors: [
          { id: 'h5074_3ea3', name: 'Humidor 1', humidity: 69, temperature: 18.4, battery: 81, updated: ago(2 * MIN), status: { level: 'ok', label: 'in range' } },
          { id: 'h5074_9b21', name: 'Humidor 2', humidity: 66, temperature: 19.1, battery: 64, updated: ago(4 * MIN), status: { level: 'ok', label: 'in range' } }
        ]
      },
      betbot: { live: true, todayPnlCents: 1240, sinceArmPnlCents: 3175, openOrders: 3, recorder: 'running', lastError: null }
    },
    today: {
      streams: { streams: 2, transcoding: 1 },
      requests: { pending: 3 },
      added: { episodes: 12, films: 2 },
      uptime: 0.997
    }
  };
}

export function service(id) {
  const s = SERVICES.find(x => x.id === id);
  if (!s) return null;
  const extras = {
    sonarr: [
      { title: 'Queue', rows: [{ label: 'The Coastline · S2 E5', value: 'downloading 64%' }, { label: 'Night Kitchen · S1 E8', value: 'queued' }, { label: 'Harbour Patrol · S4 E1', value: 'importing' }], empty: 'Nothing in the queue' },
      { title: 'Airing soon', rows: [{ label: 'Night Kitchen · S1 E9', value: 'Mon 8:30 pm' }, { label: 'The Coastline · S2 E6', value: 'Wed 7:00 pm' }], empty: 'Nothing in the next 7 days' }
    ],
    'adguard-home': [
      { title: 'Top clients', rows: [{ label: 'living-room-tv', value: '4,812' }, { label: 'iphone181', value: '3,105' }, { label: 'rocky', value: '2,644' }], empty: 'No queries' },
      { title: 'Most blocked', rows: [{ label: 'telemetry.example-tv.com', value: '1,921' }, { label: 'ads.example.net', value: '640' }], empty: 'Nothing blocked' }
    ]
  }[id] || null;
  return {
    demo: true,
    generatedAt: new Date().toISOString(),
    service: { id: s.id, kind: s.kind, name: s.name, host: s.host, url: s.url, container: s.id },
    status: s.status,
    check: { ...s.check, uptime24h: s.check.uptime24h },
    container: { name: s.id, image: `lscr.io/linuxserver/${s.id}:latest`, state: 'running', status: 'Up 2 days', health: null },
    extras
  };
}

// ---- Kiosk ----
const state = {
  lights: { 'light.living_room': true, 'light.kitchen': true, 'light.porch': false, 'light.bedroom': false },
  climate: { target: 23, mode: 'cool' },
  tasks: {
    t1: { list: 'family', title: 'Pay the water bill', due: 0, done: false },
    t2: { list: 'family', title: 'Book the car service', due: 2, done: false },
    t3: { list: 'family', title: 'Sign the school excursion form', due: 0, done: true },
    t4: { list: 'family', title: 'Water the vegie patch', due: null, done: false },
    t5: { list: 'family', title: 'Return library books', due: 4, done: false },
    s1: { list: 'shopping', title: 'Puff pastry', due: null, done: false },
    s2: { list: 'shopping', title: 'Leeks', due: null, done: false },
    s3: { list: 'shopping', title: 'Milk', due: null, done: false },
    a1: { list: 'alby', title: 'Renew car rego', due: 6, done: false }
  }
};

function at(dayOffset, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}
function dateOnly(dayOffset) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  return d.toLocaleDateString('en-CA');
}

export function kiosk() {
  const lists = [['family', 'Family'], ['shopping', 'Shopping'], ['alby', 'Alby']].map(([id, name]) => ({
    id,
    name,
    items: Object.entries(state.tasks).filter(([, t]) => t.list === id).map(([tid, t]) => ({
      id: tid,
      title: t.title,
      due: t.due == null ? null : `${dateOnly(t.due)}T00:00:00.000Z`,
      done: t.done,
      completedAt: t.done ? ago(40 * MIN) : null
    })).sort((a, b) => Number(a.done) - Number(b.done))
  }));
  return {
    demo: true,
    generatedAt: new Date().toISOString(),
    weather: {
      now: { temp: 24, text: 'Mostly sunny', icon: 'sun', uvMax: 9 },
      today: { max: 27, min: 15 },
      days: [
        { date: dateOnly(1), max: 27, min: 16, text: 'Clear', icon: 'sun' },
        { date: dateOnly(2), max: 22, min: 14, text: 'Partly cloudy', icon: 'partly' },
        { date: dateOnly(3), max: 19, min: 12, text: 'Rain', icon: 'rain' }
      ]
    },
    calendar: [
      { id: 'e1', title: 'Swimming pickup', location: 'Aquatic centre', allDay: false, start: at(0, 17, 30), end: at(0, 18) },
      { id: 'e2', title: 'Movie night', location: 'Living room', allDay: false, start: at(0, 19), end: at(0, 21) },
      { id: 'e3', title: 'Grocery delivery', location: null, allDay: true, start: dateOnly(1), end: dateOnly(2) },
      { id: 'e4', title: 'Saturday sport', location: 'Oval 2', allDay: false, start: at(1, 9), end: at(1, 11) },
      { id: 'e5', title: "Lunch at Nan's", location: null, allDay: false, start: at(1, 12, 30), end: at(1, 15) }
    ],
    tasks: lists,
    bins: { date: dateOnly(1), weekday: 'tuesday', tonight: true, isToday: false, streams: [{ name: 'General waste', colour: 'red' }, { name: 'Recycling', colour: 'yellow' }] },
    people: [
      { name: 'Alby', home: true, place: 'Home', since: ago(3 * HOUR) },
      { name: 'Person 2', home: true, place: 'Home', since: ago(5 * HOUR) },
      { name: 'Person 3', home: false, place: 'Out', since: ago(2 * HOUR) }
    ],
    dinner: { title: 'Chicken and leek pie', minutes: 45, servings: 4 },
    house: {
      scenes: [
        { id: 'scene.movie_night', name: 'Movie night' },
        { id: 'scene.dinner', name: 'Dinner' },
        { id: 'scene.bedtime', name: 'Bedtime' },
        { id: 'scene.leaving_home', name: 'Leaving home' }
      ],
      lights: Object.entries(state.lights).map(([id, on]) => ({
        id,
        name: { 'light.living_room': 'Living', 'light.kitchen': 'Kitchen', 'light.porch': 'Porch', 'light.bedroom': 'Bedroom' }[id],
        on,
        brightness: on && id === 'light.living_room' ? 70 : null
      })),
      climate: [{ id: 'climate.living_room', name: 'Air conditioner', mode: state.climate.mode, action: state.climate.mode === 'off' ? 'off' : 'cooling', target: state.climate.target, current: 25, min: 18, max: 26 }],
      humidors: [{ name: 'Humidor 1', humidity: 69, ok: true, label: 'in range' }, { name: 'Humidor 2', humidity: 66, ok: true, label: 'in range' }],
      humidorRange: [65, 70]
    },
    media: {
      resume: [
        { id: 'demo1', title: 'The Coastline', detail: 'S2 E4', minutesLeft: 18, progress: 64 },
        { id: 'demo2', title: 'Night Kitchen', detail: 'S1 E7', minutesLeft: 41, progress: 20 },
        { id: 'demo3', title: 'Small Engines', detail: 'Film', minutesLeft: 9, progress: 88 },
        { id: 'demo4', title: 'Harbour Patrol', detail: 'S4 E1', minutesLeft: 52, progress: 5 }
      ],
      requests: [
        { title: 'Harbour Patrol, season 4', status: 'Ready to watch', ready: true, added: ago(3 * 86400000) },
        { title: 'The Long Field', status: 'Downloading', ready: false, added: ago(86400000) },
        { title: 'Paper Moons, season 1', status: 'Waiting for release', ready: false, added: ago(2 * HOUR) }
      ]
    },
    system: {
      level: 'warn',
      headline: 'Almost everything is working',
      message: "New TV downloads isn't working right now. Alby has been sent an alert.",
      services: [
        { name: 'Movies & TV', ok: true, note: 'OK' },
        { name: 'Requests', ok: true, note: 'OK' },
        { name: 'Home controls', ok: true, note: 'OK' },
        { name: 'Recipes', ok: true, note: 'OK' },
        { name: 'New TV downloads', ok: false, note: 'Not working · Alby has been told' },
        { name: 'Internet', ok: true, note: 'OK' }
      ]
    }
  };
}

export function action(body) {
  const { action: kind, id } = body || {};
  if (kind === 'light' && id in state.lights) state.lights[id] = !state.lights[id];
  else if (kind === 'climate') {
    if (body.value === 'off') state.climate.mode = 'off';
    else { state.climate.mode = 'cool'; state.climate.target = Math.min(26, Math.max(18, state.climate.target + Number(body.value))); }
  } else if (kind === 'task' && state.tasks[id]) state.tasks[id].done = body.done === true;
  else if (kind !== 'scene') {
    const err = new Error('unknown action');
    err.name = 'BadAction';
    throw err;
  }
}
