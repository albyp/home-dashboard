import { get } from '../lib/http.js';
import { cached } from '../lib/cache.js';

// Today's sun, for deciding when to run the aircon and other big loads while
// the solar system isn't connected to Home Assistant. Open-Meteo forecast
// (free, no key), for the same place as the weather.
//
// Open-Meteo's hourly radiation is the mean over the hour *before* each time,
// so the value at 10:00 describes 09:00–10:00. Hours here are labelled by
// their start.
//
// Optional settings (sources.solar in dashboard.yaml, normally ${VAR}s from .env
// so nothing about the house is in git):
//   goodWatts   sunlight (W/m²) that counts as "strong", default 500
//   systemKw    panel size; adds a rough kWh estimate for the day
//   tilt, azimuth  panel angle; uses sunlight on the panel instead of on flat
//               ground. Open-Meteo azimuth: 0 = facing south, 180 = facing north
//   feedInPeak  hours of the higher feed-in rate, "15:00-21:00"

const PERFORMANCE_RATIO = 0.8; // typical losses: heat, inverter, wiring, dust

const hhmm = h => `${String(h).padStart(2, '0')}:00`;

// Longest run of consecutive strong hours, as { start, end } in HH:MM
function strongWindow(hours, good) {
  let best = null;
  let run = null;
  for (const h of hours) {
    if (h.w >= good) {
      run = run ? { ...run, end: h.hour + 1 } : { start: h.hour, end: h.hour + 1 };
      if (!best || run.end - run.start > best.end - best.start) best = run;
    } else run = null;
  }
  return best && { start: hhmm(best.start), end: hhmm(best.end), hours: best.end - best.start };
}

function day(res, date, field, good) {
  const t = res.hourly.time;
  const hours = [];
  for (let i = 0; i < t.length; i++) {
    if (!t[i].startsWith(date)) continue;
    const endHour = Number(t[i].slice(11, 13));
    if (endHour === 0) continue; // 23:00–24:00 belongs to the day before
    hours.push({ hour: endHour - 1, w: Math.round(res.hourly[field][i] ?? 0), cloud: res.hourly.cloud_cover[i], uv: res.hourly.uv_index?.[i] });
  }
  // The day after midnight's first value: 23:00–24:00
  const next = t.findIndex(x => x > date && x.endsWith('T00:00'));
  if (next >= 0) hours.push({ hour: 23, w: Math.round(res.hourly[field][next] ?? 0), cloud: res.hourly.cloud_cover[next], uv: res.hourly.uv_index?.[next] });

  const d = res.daily.time.indexOf(date);
  const sunrise = res.daily.sunrise[d].slice(11, 16);
  const sunset = res.daily.sunset[d].slice(11, 16);
  const lit = hours.filter(h => h.hour >= Number(sunrise.slice(0, 2)) && h.hour <= Number(sunset.slice(0, 2)));
  const kwhPerM2 = Math.round((hours.reduce((s, h) => s + h.w, 0) / 1000) * 10) / 10;
  const cloud = lit.length ? Math.round(lit.reduce((s, h) => s + h.cloud, 0) / lit.length) : null;
  return { date, sunrise, sunset, hours: lit, kwhPerM2, cloud, window: strongWindow(lit, good) };
}

const minutes = hm => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

function solarNoon(sunrise, sunset) {
  const m = Math.round((minutes(sunrise) + minutes(sunset)) / 2);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Pure: turns an Open-Meteo response into what the pages show. nowMs is passed
// in so the demo and tests can pick the time of day.
export function analyse(res, opts = {}, nowMs = Date.now()) {
  const good = opts.goodWatts || 500;
  const field = res.hourly.global_tilted_irradiance ? 'global_tilted_irradiance' : 'shortwave_radiation';
  const local = new Date(nowMs + res.utc_offset_seconds * 1000).toISOString();
  const today = local.slice(0, 10);
  const nowHm = local.slice(11, 16);
  const t = day(res, today, field, good);
  const tomorrowDate = res.daily.time.find(x => x > today);
  const tm = tomorrowDate ? day(res, tomorrowDate, field, good) : null;

  const nowHour = Number(nowHm.slice(0, 2));
  const current = t.hours.find(h => h.hour === nowHour) || null;
  const w = t.window;
  let state;
  if (nowHm < t.sunrise) state = 'before';
  else if (nowHm >= t.sunset) state = 'night';
  else if (!w) state = 'low';
  else if (nowHm < w.start) state = 'later';
  else if (nowHm < w.end) state = 'now';
  else state = 'past';

  const kwh = v => (opts.systemKw ? Math.round(v * opts.systemKw * PERFORMANCE_RATIO * 10) / 10 : null);
  return {
    now: nowHm,
    state,
    goodWatts: good,
    onPanel: field === 'global_tilted_irradiance',
    current: current && { w: current.w, cloud: current.cloud, uv: current.uv },
    today: { ...t, solarNoon: solarNoon(t.sunrise, t.sunset), estimateKwh: kwh(t.kwhPerM2), uvMax: Math.round(res.daily.uv_index_max?.[res.daily.time.indexOf(today)] ?? 0) },
    tomorrow: tm && { date: tm.date, window: tm.window, kwhPerM2: tm.kwhPerM2, cloud: tm.cloud, estimateKwh: kwh(tm.kwhPerM2) },
    feedInPeak: hoursRange(opts.feedInPeak)
  };
}

// "15:00-21:00" or ['15:00', '21:00'] → ['15:00', '21:00']; anything else → null
function hoursRange(v) {
  const parts = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\s*[-–]\s*/) : [];
  const ok = parts.length === 2 && parts.every(p => /^\d{2}:\d{2}$/.test(p)) && parts[0] < parts[1];
  return ok ? parts : null;
}

// Settings arrive as strings from ${VAR}s; empty means not set
function options(raw = {}) {
  const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    enabled: raw.enabled !== false && raw.enabled !== 'false',
    goodWatts: num(raw.goodWatts) || 500,
    systemKw: num(raw.systemKw),
    tilt: num(raw.tilt),
    azimuth: num(raw.azimuth),
    feedInPeak: raw.feedInPeak
  };
}

export function solar(config) {
  const where = config.sources.weather;
  if (!where?.latitude || !where?.longitude) return null;
  const opts = options(config.sources.solar || {});
  if (!opts.enabled) return null;
  return cached('solar', async () => {
    const hourly = ['shortwave_radiation', 'cloud_cover', 'uv_index'];
    const q = new URLSearchParams({
      latitude: where.latitude,
      longitude: where.longitude,
      daily: 'sunrise,sunset,uv_index_max',
      timezone: 'auto',
      forecast_days: '3'
    });
    if (opts.tilt != null) {
      hourly.push('global_tilted_irradiance');
      q.set('tilt', opts.tilt);
      q.set('azimuth', opts.azimuth ?? 180);
    }
    q.set('hourly', hourly.join(','));
    const res = await get(`https://api.open-meteo.com/v1/forecast?${q}`);
    return { forecast: res, opts };
  }, 15 * 60 * 1000).then(r => (r.error ? r : analyse(r.forecast, r.opts)));
}
