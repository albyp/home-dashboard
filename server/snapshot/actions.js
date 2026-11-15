import { loadConfig } from '../config.js';
import { allowWrite, clearAllowList, write, RefusedError } from '../lib/http.js';
import { invalidate } from '../lib/cache.js';
import { haStates } from '../sources/homeassistant.js';
import { accessToken, TASKS_BASE } from '../sources/google.js';

// The kiosk's only writes. Each action names an entity or task list that must be
// listed in dashboard.yaml (kiosk.house / kiosk.taskLists). The HTTP client
// also refuses any write URL not registered here.
const HA_SERVICES = [['scene', 'turn_on'], ['light', 'toggle'], ['climate', 'set_temperature'], ['climate', 'turn_off'], ['climate', 'turn_on']];

export function registerAllowList(config = loadConfig()) {
  clearAllowList();
  const ha = config.sources.homeassistant;
  if (ha?.url && config.kiosk.house) {
    const base = new URL(ha.url).origin;
    for (const [domain, service] of HA_SERVICES) allowWrite('POST', `${base}/api/services/${domain}/${service}`);
  }
  for (const list of config.kiosk.taskLists || []) {
    if (list.id) allowWrite('PATCH', `${TASKS_BASE}/${encodeURIComponent(list.id)}/tasks/*`);
  }
}

class BadAction extends Error {}

async function callHa(config, domain, service, data) {
  const ha = config.sources.homeassistant;
  await write('POST', `${new URL(ha.url).origin}/api/services/${domain}/${service}`, {
    headers: { Authorization: `Bearer ${ha.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  invalidate('ha:');
}

export async function runAction(body) {
  const config = loadConfig();
  const house = config.kiosk.house || {};
  const { action, id } = body || {};
  if (typeof action !== 'string' || typeof id !== 'string') throw new BadAction('action and id are required');

  switch (action) {
    case 'scene':
      if (!(house.scenes || []).includes(id)) throw new BadAction('scene not allowed');
      return callHa(config, 'scene', 'turn_on', { entity_id: id });

    case 'light':
      if (!(house.lights || []).includes(id)) throw new BadAction('light not allowed');
      return callHa(config, 'light', 'toggle', { entity_id: id });

    case 'climate': {
      const cfg = (house.climate || []).find(c => c.entity === id);
      if (!cfg) throw new BadAction('climate entity not allowed');
      if (body.value === 'off') return callHa(config, 'climate', 'turn_off', { entity_id: id });
      const step = Number(body.value);
      if (![-1, -0.5, 0.5, 1].includes(step)) throw new BadAction('climate step must be ±0.5 or ±1');
      const states = await haStates(config);
      const current = Number(states?.byId?.[id]?.attributes?.temperature);
      if (!Number.isFinite(current)) throw new BadAction('no current target temperature');
      const target = Math.min(cfg.max ?? 30, Math.max(cfg.min ?? 16, current + step));
      return callHa(config, 'climate', 'set_temperature', { entity_id: id, temperature: target });
    }

    case 'task': {
      const list = (config.kiosk.taskLists || []).find(l => l.id === body.list);
      if (!list) throw new BadAction('task list not allowed');
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new BadAction('bad task id');
      const done = body.done === true;
      await write('PATCH', `${TASKS_BASE}/${encodeURIComponent(list.id)}/tasks/${id}`, {
        headers: { Authorization: `Bearer ${await accessToken(config)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(done ? { status: 'completed' } : { status: 'needsAction', completed: null })
      });
      invalidate('google:tasks');
      return;
    }

    default:
      throw new BadAction('unknown action');
  }
}

export { BadAction, RefusedError };
