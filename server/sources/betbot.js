import { get } from '../lib/http.js';
import { cached } from '../lib/cache.js';

// Admin overview only. Never sent to the kiosk.
export function betbot(config) {
  const src = config.sources.betbot;
  if (!src?.url || !config.home.betbot) return null;
  return cached('betbot', async () => {
    const state = await get(`${src.url.replace(/\/$/, '')}/api/state`);
    const live = state.live || {};
    const engine = state.engine || {};
    return {
      live: !!live.live,
      todayPnlCents: live.today_pnl_cents ?? 0,
      sinceArmPnlCents: live.since_arm_pnl_cents ?? null,
      openOrders: live.open_orders ?? 0,
      recorder: engine.status || engine.process || null,
      lastError: live.last_error || null
    };
  });
}
