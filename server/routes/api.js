import express from 'express';
import { adminSnapshot, serviceSnapshot } from '../snapshot/admin.js';
import { kioskSnapshot } from '../snapshot/kiosk.js';
import { runAction, BadAction, RefusedError } from '../snapshot/actions.js';
import { jellyfinImage } from '../sources/apps.js';
import { loadConfig, isDemo } from '../config.js';
import * as demo from '../demo.js';

const router = express.Router();

// Express 4 doesn't catch rejected promises from async handlers
const wrap = fn => (req, res) => fn(req, res).catch(error => {
  console.error(`${req.path}:`, error);
  res.status(500).json({ error: 'Could not build this page' });
});

router.get('/health', (req, res) => res.json({ ok: true }));

router.get('/overview', wrap(async (req, res) => {
  res.json(isDemo() ? demo.admin() : await adminSnapshot());
}));

router.get('/service/:id', wrap(async (req, res) => {
  const data = isDemo() ? demo.service(req.params.id) : await serviceSnapshot(req.params.id);
  if (!data) return res.status(404).json({ error: 'No such service' });
  res.json(data);
}));

router.get('/kiosk', wrap(async (req, res) => {
  res.json(isDemo() ? demo.kiosk() : await kioskSnapshot());
}));

router.get('/kiosk/poster/:id', async (req, res) => {
  if (isDemo()) return res.status(404).end();
  try {
    const img = await jellyfinImage(loadConfig(), req.params.id);
    if (!img) return res.status(404).end();
    res.set({ 'Content-Type': img.type || 'image/jpeg', 'Cache-Control': 'private, max-age=86400' }).send(img.data);
  } catch {
    res.status(404).end();
  }
});

// The kiosk's only write route. JSON only, plus a custom header: a cross-site
// form can't send either (and the cookie is SameSite=Strict anyway).
router.post('/kiosk/action', express.json({ limit: '2kb' }), async (req, res) => {
  if (req.get('X-Dashboard') !== '1' || !req.is('application/json')) return res.status(400).json({ error: 'bad request' });
  try {
    if (isDemo()) demo.action(req.body);
    else await runAction(req.body);
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof BadAction) return res.status(400).json({ error: error.message });
    if (error instanceof RefusedError) return res.status(403).json({ error: error.message });
    console.error('Kiosk action failed:', error.message);
    res.status(502).json({ error: 'That did not work. Try again.' });
  }
});

export default router;
