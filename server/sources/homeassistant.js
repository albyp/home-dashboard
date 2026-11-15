import { get } from '../lib/http.js';
import { cached } from '../lib/cache.js';

const base = src => src.url.replace(/\/$/, '');
const headers = src => ({ Authorization: `Bearer ${src.token}` });

export function haStates(config) {
  const src = config.sources.homeassistant;
  if (!src?.token) return null;
  return cached('ha:states', async () => {
    const states = await get(`${base(src)}/api/states`, { headers: headers(src) });
    return { byId: Object.fromEntries(states.map(s => [s.entity_id, s])), all: states };
  }, 10000);
}

// ---- Humidors: Govee H5xxx BLE sensors, e.g. sensor.h5074_3ea3_humidity ----
function assess(rh, temp, stale, lim) {
  if (stale) return { level: 'warn', label: 'no recent data' };
  if (rh != null && rh < lim.humidity[0] - 7) return { level: 'bad', label: 'too dry' };
  if (rh != null && rh > lim.humidity[1] + 3) return { level: 'bad', label: 'too wet, mould risk' };
  if (temp != null && temp >= 24) return { level: 'bad', label: 'too warm, beetle risk' };
  if (rh != null && rh < lim.humidity[0]) return { level: 'warn', label: 'drying out' };
  if (rh != null && rh > lim.humidity[1]) return { level: 'warn', label: 'running wet' };
  if (temp != null && (temp < lim.temperature[0] || temp > lim.temperature[1])) return { level: 'warn', label: 'temperature out of range' };
  return { level: 'ok', label: 'in range' };
}

export async function humidors(config) {
  const cfg = config.home.humidors;
  const states = await haStates(config);
  if (!cfg || !states || states.error) return states?.error ? { error: states.error } : null;
  const lim = { humidity: cfg.humidity || [65, 70], temperature: cfg.temperature || [16, 21] };
  const re = new RegExp(cfg.match || '^sensor\\.h5\\d{3}_[0-9a-f]+_', 'i');

  const devices = new Map();
  for (const s of states.all) {
    const m = s.entity_id.match(/^(sensor\.[a-z0-9_]+?)_(temperature|humidity|battery)$/);
    if (!m || !re.test(s.entity_id)) continue;
    if (!devices.has(m[1])) devices.set(m[1], {});
    devices.get(m[1])[m[2]] = s;
  }
  const num = s => (s && Number.isFinite(Number(s.state)) ? Number(s.state) : null);
  const list = [...devices.entries()].filter(([, d]) => d.humidity).map(([prefix, d]) => {
    const updated = [d.humidity, d.temperature].filter(Boolean).map(s => s.last_updated).sort().pop();
    const stale = !updated || Date.now() - new Date(updated).getTime() > 30 * 60000;
    const humidity = num(d.humidity);
    const temperature = num(d.temperature);
    return {
      id: prefix.replace('sensor.', ''),
      name: (d.humidity.attributes.friendly_name || prefix).replace(/\s*humidity$/i, '').replace(/^humidor\s*[-–]\s*/i, ''),
      humidity,
      temperature,
      battery: num(d.battery),
      updated,
      status: assess(humidity, temperature, stale, lim)
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { limits: lim, humidors: list };
}

// ---- Kiosk: people and house ----
export async function people(config) {
  const ids = config.kiosk.people || [];
  if (!ids.length) return null;
  const states = await haStates(config);
  if (!states || states.error) return states?.error ? { error: states.error } : null;
  return ids.map(id => states.byId[id]).filter(Boolean).map(s => ({
    name: s.attributes.friendly_name || s.entity_id.replace('person.', ''),
    home: s.state === 'home',
    place: s.state === 'home' ? 'Home' : s.state === 'not_home' ? 'Out' : s.state,
    since: s.last_changed
  }));
}

export async function house(config) {
  const cfg = config.kiosk.house;
  if (!cfg) return null;
  const states = await haStates(config);
  if (!states || states.error) return states?.error ? { error: states.error } : null;
  const name = s => s.attributes.friendly_name || s.entity_id;
  return {
    scenes: (cfg.scenes || []).map(id => states.byId[id]).filter(Boolean).map(s => ({ id: s.entity_id, name: name(s) })),
    lights: (cfg.lights || []).map(id => states.byId[id]).filter(Boolean).map(s => ({
      id: s.entity_id,
      name: name(s).replace(/\s*lights?$/i, ''),
      on: s.state === 'on',
      brightness: s.attributes.brightness != null ? Math.round((s.attributes.brightness / 255) * 100) : null
    })),
    climate: (cfg.climate || []).map(c => ({ cfg: c, s: states.byId[c.entity] })).filter(x => x.s).map(({ cfg: c, s }) => ({
      id: s.entity_id,
      name: name(s),
      mode: s.state,
      action: s.attributes.hvac_action || null,
      target: s.attributes.temperature ?? null,
      current: s.attributes.current_temperature ?? null,
      min: c.min ?? 16,
      max: c.max ?? 30
    }))
  };
}
