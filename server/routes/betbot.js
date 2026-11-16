import express from 'express';
import { get } from '../lib/http.js';
import { loadConfig } from '../config.js';

// betbot's own page, passed through read-only. betbot publishes it on loopback only;
// this makes it reachable behind the dashboard login. Admin only: a kiosk session
// can't open it (auth.js KIOSK_PATHS). Only these two GET paths are passed through,
// and betbot's own Content-Security-Policy replaces the dashboard's for its page.
const PASS_HEADERS = ['content-type', 'cache-control', 'content-security-policy'];

export default function betbotRouter() {
  const router = express.Router();

  // The page fetches 'api/state' relative to itself, so it needs the trailing slash
  router.get(/^\/betbot$/, (req, res) => res.redirect(302, '/betbot/'));

  router.get(['/betbot/', '/betbot/api/state'], async (req, res) => {
    const src = loadConfig().sources.betbot;
    if (!src?.url) return res.status(404).type('text').send('betbot is not configured');
    try {
      const upstream = await get(`${src.url.replace(/\/$/, '')}${req.path.replace(/^\/betbot/, '')}`, { as: 'response', timeout: 10000 });
      for (const header of PASS_HEADERS) {
        const value = upstream.headers.get(header);
        if (value) res.set(header, value);
      }
      res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      res.status(502).json({ error: `betbot unreachable: ${error.message}` });
    }
  });

  return router;
}
