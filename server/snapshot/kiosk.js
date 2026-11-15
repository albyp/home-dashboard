import { loadConfig } from '../config.js';
import { getGatus, findCheck } from '../sources/gatus.js';
import { internet, jellyfinResume, seerrRequests, tandoorToday } from '../sources/apps.js';
import { humidors, people, house } from '../sources/homeassistant.js';
import { calendar, tasks } from '../sources/google.js';
import { weather } from '../sources/weather.js';
import { bins } from '../sources/bins.js';

// The family screen. Deliberately reduced: no IPs, hosts, containers or betbot.
const ok = v => v && !v.error;
const keep = v => (v == null ? null : v.error ? { error: 'Not available right now' } : v);

async function systemSummary(config) {
  const items = config.kiosk.system || [];
  if (!items.length) return null;
  const [gatus, net] = await Promise.all([getGatus(config), internet()]);
  const services = items.map(item => {
    if (/^internet$/i.test(item.check)) {
      return { name: item.label, ok: ok(net) ? net.up : null, note: ok(net) && net.up ? 'OK' : 'Down' };
    }
    const c = findCheck(gatus, item.check);
    if (!c) return { name: item.label, ok: null, note: 'Unknown' };
    return { name: item.label, ok: c.status === 'ok', note: c.status === 'ok' ? 'OK' : 'Not working' };
  });
  const broken = services.filter(s => s.ok === false);
  if (services.every(s => s.ok === null)) {
    return { level: 'unknown', headline: 'Status not available', message: 'The screen cannot check the services right now.', services };
  }
  let level = 'ok';
  let headline = 'Everything is working';
  let message = `${services.map(s => s.name).join(', ')}: all fine.`;
  if (broken.length === 1) {
    level = 'warn';
    headline = 'Almost everything is working';
    message = `${broken[0].name} isn't working right now. Tell Alby if it stays that way.`;
  } else if (broken.length > 1) {
    level = 'bad';
    headline = 'A few things are not working';
    message = `${broken.map(b => b.name).join(', ')} are down. Tell Alby if they stay that way.`;
  }
  return { level, headline, message, services };
}

export async function kioskSnapshot() {
  const config = loadConfig();
  const [w, cal, tk, who, dinner, h, hum, resume, requests, system] = await Promise.all([
    weather(config),
    calendar(config),
    tasks(config),
    people(config),
    tandoorToday(config),
    house(config),
    config.kiosk.house?.humidors ? humidors(config) : null,
    jellyfinResume(config),
    seerrRequests(config),
    systemSummary(config)
  ]);

  return {
    generatedAt: new Date().toISOString(),
    weather: keep(w),
    calendar: keep(cal),
    tasks: keep(tk),
    bins: bins(config),
    people: keep(who),
    // Left out when Tandoor isn't set up; null when nothing is planned today
    dinner: dinner == null ? undefined : ok(dinner) ? dinner.dinner : keep(dinner),
    house: h ? {
      ...keep(h),
      humidors: ok(hum) ? hum.humidors.map(x => ({ name: x.name, humidity: x.humidity, ok: x.status.level === 'ok', label: x.status.label })) : null,
      humidorRange: ok(hum) ? hum.limits.humidity : null
    } : null,
    media: {
      resume: keep(resume),
      requests: ok(requests) ? requests.items.map(({ requestedBy, ...r }) => r) : keep(requests)
    },
    system
  };
}
