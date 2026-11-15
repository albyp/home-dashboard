// Sources are read when a page asks, then kept for a short time (no database).
// One failing source never blanks the page: it returns { error } instead.
const entries = new Map();

export const DEFAULT_TTL = Number(process.env.CACHE_SECONDS || 30) * 1000;

export async function cached(name, fn, ttl = DEFAULT_TTL) {
  const hit = entries.get(name);
  if (hit && Date.now() - hit.at < ttl) return hit.promise;
  const promise = Promise.resolve()
    .then(fn)
    .catch(error => {
      console.error(`[${name}]`, error.message);
      return { error: error.message };
    });
  entries.set(name, { at: Date.now(), promise });
  return promise;
}

export function invalidate(prefix) {
  for (const name of entries.keys()) if (name.startsWith(prefix)) entries.delete(name);
}
