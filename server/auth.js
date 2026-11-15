import crypto from 'crypto';
import express from 'express';
import { isDemo } from './config.js';

// Two roles, one login page. The password decides the role.
//   admin  DASHBOARD_PASSWORD_HASH  everything, 30-day session
//   kiosk  KIOSK_PASSWORD_HASH      /kiosk and its API only, 1-year session
// Hashes are scrypt:<salt hex>:<key hex> (no '$', which compose would interpolate).
// SESSION_SECRET signs the cookie. Set all three with ./set-password.sh.
const COOKIE = 'dash_session';
const ROLES = {
  admin: { hashVar: 'DASHBOARD_PASSWORD_HASH', days: 30, home: '/' },
  kiosk: { hashVar: 'KIOSK_PASSWORD_HASH', days: 365, home: '/kiosk' }
};
const MAX_FAILURES = 10;
const LOCKOUT_MS = 15 * 60 * 1000;
const failures = { count: 0, since: 0 };

// Paths a kiosk session may open
const KIOSK_PATHS = [/^\/kiosk\/?$/, /^\/api\/kiosk(\/|$)/, /^\/assets\//, /^\/favicon\.svg$/, /^\/api\/health$/];

const demo = isDemo;
function configured() {
  return demo() || Boolean(process.env.SESSION_SECRET && process.env.DASHBOARD_PASSWORD_HASH);
}
const secret = () => process.env.SESSION_SECRET || 'demo-only-secret';

function scrypt(password, salt) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return `scrypt:${salt.toString('hex')}:${(await scrypt(password, salt)).toString('hex')}`;
}

async function matches(hash, password) {
  const [scheme, saltHex, keyHex] = (hash || '').split(':');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(String(password), Buffer.from(saltHex, 'hex'));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function roleFor(password) {
  if (demo()) return password === 'kiosk' ? 'kiosk' : password === 'admin' ? 'admin' : null;
  for (const [role, { hashVar }] of Object.entries(ROLES)) {
    if (await matches(process.env[hashVar], password)) return role;
  }
  return null;
}

const sign = value => crypto.createHmac('sha256', secret()).update(value).digest('hex');

function makeToken(role) {
  const expires = Date.now() + ROLES[role].days * 86400000;
  return `${role}.${expires}.${sign(`${role}.${expires}`)}`;
}

export function sessionRole(req) {
  const [role, expires, mac] = (readCookie(req, COOKIE) || '').split('.');
  if (!ROLES[role] || !expires || !mac || Number(expires) < Date.now()) return null;
  const expected = Buffer.from(sign(`${role}.${expires}`), 'hex');
  const given = Buffer.from(mac, 'hex');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? role : null;
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function setCookie(res, value, maxAge) {
  // Secure: served over HTTPS by `tailscale serve`. In demo mode it runs on plain localhost.
  const secure = demo() ? '' : ' Secure;';
  res.set('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=${maxAge}`);
}

// Same-site paths only ('/x', never '//host' or '/\host')
const safeNext = v => (typeof v === 'string' && /^\/(?![/\\])/.test(v) ? v : null);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function loginPage(message = '', next = null) {
  const action = next ? `/login?next=${encodeURIComponent(next)}` : '/login';
  const hint = demo() ? '<p class="hint">Demo mode: password <b>admin</b> or <b>kiosk</b>.</p>' : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>home-dashboard</title>
<style>
  :root { color-scheme: light dark; --bg: #f1f4f7; --card: #fff; --ink: #16202a; --muted: #5b6977; --accent: #2d6aa8; --bad: #cc4136; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0e1318; --card: #151c23; --ink: #e2e8ee; --muted: #8b99a6; --accent: #72a9df; --bad: #ef6b5f; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--ink); }
  form { background: var(--card); padding: 2rem; border-radius: 14px; width: min(340px, calc(100vw - 32px)); box-sizing: border-box; display: grid; gap: .8rem; }
  h1 { margin: 0 0 .25rem; font-size: 1.25rem; }
  input, button { font: inherit; padding: .75rem .9rem; border-radius: 10px; border: 1px solid #8884; background: transparent; color: inherit; }
  button { background: var(--accent); color: #fff; border: 0; cursor: pointer; font-weight: 600; }
  .msg { color: var(--bad); font-size: .9rem; min-height: 1.2em; margin: 0; }
  .hint { color: var(--muted); font-size: .85rem; margin: 0; }
</style></head>
<body><form method="post" action="${escapeHtml(action)}">
  <h1>home-dashboard</h1>
  <input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
  <button type="submit">Log in</button>
  <p class="msg">${escapeHtml(message)}</p>${hint}
</form></body></html>`;
}

export function authRouter() {
  const router = express.Router();
  router.use('/login', express.urlencoded({ extended: false, limit: '2kb' }));

  router.get('/login', (req, res) => {
    const role = sessionRole(req);
    if (role) return res.redirect(302, safeNext(req.query.next) || ROLES[role].home);
    res.type('html').send(loginPage(configured() ? '' : 'Login is not set up. Run ./set-password.sh on the host.', safeNext(req.query.next)));
  });

  router.post('/login', async (req, res) => {
    const next = safeNext(req.query.next);
    if (!configured()) return res.status(503).type('html').send(loginPage('Login is not set up. Run ./set-password.sh on the host.', next));
    // Global lockout: behind `tailscale serve` every request comes from 127.0.0.1
    if (failures.count >= MAX_FAILURES && Date.now() - failures.since < LOCKOUT_MS) {
      return res.status(429).type('html').send(loginPage('Too many attempts. Try again in 15 minutes.', next));
    }
    const role = await roleFor(req.body?.password ?? '');
    if (role) {
      failures.count = 0;
      setCookie(res, makeToken(role), ROLES[role].days * 86400);
      const target = next && (role === 'admin' || KIOSK_PATHS.some(p => p.test(next))) ? next : ROLES[role].home;
      return res.redirect(303, target);
    }
    if (Date.now() - failures.since >= LOCKOUT_MS) { failures.since = Date.now(); failures.count = 0; }
    failures.count += 1;
    console.warn(`Failed login (${failures.count}/${MAX_FAILURES})`);
    res.status(401).type('html').send(loginPage('Wrong password.', next));
  });

  router.post('/logout', (req, res) => {
    setCookie(res, '', 0);
    res.redirect(303, '/login');
  });

  return router;
}

export function requireLogin(req, res, next) {
  if (req.path === '/api/health') return next();
  const role = configured() ? sessionRole(req) : null;
  if (role === 'admin') return next();
  if (role === 'kiosk') {
    if (KIOSK_PATHS.some(p => p.test(req.path))) return next();
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'not allowed for the kiosk' });
    return res.redirect(302, '/kiosk');
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'login required' });
  res.redirect(302, req.originalUrl === '/' ? '/login' : `/login?next=${encodeURIComponent(req.originalUrl)}`);
}
