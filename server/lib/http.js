// The only module that talks HTTP to sources. Everything else goes through it.
//
// Read-only by design:
//   get()    GET requests, to any source.
//   login()  A POST that only fetches a session or token (qBittorrent login,
//            Google token refresh). Callers must name it as a login.
//   write()  A POST/PATCH that changes something. Refused unless the exact
//            method + URL was put on the allow-list at startup from
//            dashboard.yaml (kiosk house controls, Google Tasks ticks).
//
// Nothing else exists: there is no generic request() to reach for.

const allowList = new Set();

export class RefusedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RefusedError';
  }
}

function key(method, url) {
  const u = new URL(url);
  return `${method.toUpperCase()} ${u.origin}${u.pathname}`;
}

// Called once at startup by the kiosk actions module. Patterns may end in '*'
// to allow one trailing path segment (Google task IDs aren't known in advance).
export function allowWrite(method, urlPattern) {
  allowList.add(`${method.toUpperCase()} ${urlPattern}`);
}

export function clearAllowList() {
  allowList.clear();
}

function isAllowed(method, url) {
  const k = key(method, url);
  if (allowList.has(k)) return true;
  for (const entry of allowList) {
    if (!entry.endsWith('*')) continue;
    const prefix = entry.slice(0, -1);
    if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) return true;
  }
  return false;
}

async function send(method, url, { headers = {}, body, timeout = 5000, as = 'json' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const started = Date.now();
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal, redirect: 'manual' });
    const latency = Date.now() - started;
    if (as === 'response') return Object.assign(res, { latency });
    if (!res.ok) {
      res.body?.cancel?.();
      const err = new Error(`${new URL(url).host}${new URL(url).pathname} returned ${res.status}`);
      err.status = res.status;
      throw err;
    }
    if (as === 'text') return res.text();
    if (as === 'buffer') return { type: res.headers.get('content-type'), data: Buffer.from(await res.arrayBuffer()) };
    return res.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`${new URL(url).host} timed out`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function get(url, options = {}) {
  return send('GET', url, options);
}

export function login(url, options = {}) {
  return send('POST', url, options);
}

export function write(method, url, options = {}) {
  if (!['POST', 'PATCH', 'PUT'].includes(method.toUpperCase())) {
    throw new RefusedError(`Method ${method} is never allowed`);
  }
  if (!isAllowed(method, url)) {
    throw new RefusedError(`${method} ${new URL(url).pathname} is not on the allow-list`);
  }
  return send(method, url, options);
}

// GET without throwing: { ok, status, latency, error }. ok is null when unreachable.
export async function probe(url, { timeout = 3000, headers = {} } = {}) {
  try {
    const res = await send('GET', url, { timeout, headers, as: 'response' });
    res.body?.cancel?.();
    return { ok: res.status < 400, status: res.status, latency: res.latency, isHtml: (res.headers.get('content-type') || '').includes('text/html') };
  } catch (error) {
    return { ok: null, status: null, latency: null, error: error.message };
  }
}
