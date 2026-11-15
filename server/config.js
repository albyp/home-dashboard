import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG_PATH = process.env.DASHBOARD_CONFIG || path.join(__dirname, '../dashboard.yaml');

// ${VAR} and ${VAR:-default} are filled from the environment (.env).
// The YAML can live in git; only .env holds secrets.
function substitute(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g, (_, name, fallback) => process.env[name] ?? fallback ?? '');
  }
  if (Array.isArray(value)) return value.map(substitute);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v)]));
  }
  return value;
}

// Demo data for local development. Never in a production build: demo mode
// also accepts the passwords "admin" and "kiosk".
export const isDemo = () => process.env.DEMO === '1' && process.env.NODE_ENV !== 'production';

export function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normaliseService(svc, kind) {
  return {
    id: svc.id || slug(svc.name),
    kind,
    name: svc.name,
    host: svc.host || null,
    url: svc.url || null,
    check: svc.check || svc.name,
    container: svc.container || null,
    type: svc.type || null,
    api: svc.api || null,
    key: svc.key || null
  };
}

let loaded = null;
let loadedAt = 0;

export function loadConfig() {
  let stat = null;
  try { stat = fs.statSync(CONFIG_PATH); } catch { /* missing */ }
  if (loaded && stat && stat.mtimeMs <= loadedAt) return loaded;

  let raw = {};
  if (stat) {
    raw = substitute(YAML.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {});
  } else if (!isDemo()) {
    console.warn(`No config at ${CONFIG_PATH}. Copy dashboard.example.yaml to dashboard.yaml.`);
  }

  loaded = {
    title: raw.title || 'home-dashboard',
    host: raw.host || null,
    hosts: (raw.hosts || []).map(h => ({ sleeps: false, ...h })),
    apps: (raw.apps || []).map(s => normaliseService(s, 'app')),
    tools: (raw.tools || []).map(s => normaliseService(s, 'tool')),
    sources: raw.sources || {},
    repos: raw.repos || [],
    thresholds: { diskWarn: 85, diskBad: 95, backupHours: 26, ...(raw.thresholds || {}) },
    home: raw.home || {},
    kiosk: raw.kiosk || {}
  };
  loadedAt = stat ? stat.mtimeMs : Date.now();
  return loaded;
}

export function allServices(config = loadConfig()) {
  return [...config.apps, ...config.tools];
}
