import { useCallback, useEffect, useRef, useState } from 'react';

// Poll a snapshot. Keeps the last good data when a poll fails.
export function usePoll(url, intervalMs) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.status === 401) {
        window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (res.status === 403) {
        window.location.assign('/kiosk');
        return;
      }
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(body);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (err) {
      setError(err.message);
    }
  }, [url]);

  useEffect(() => {
    setData(null);
    load();
    timer.current = setInterval(load, intervalMs);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, intervalMs]);

  return { data, error, updatedAt, reload: load };
}

export async function kioskAction(body) {
  const res = await fetch('/api/kiosk/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard': '1' },
    body: JSON.stringify(body)
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || 'That did not work. Try again.');
  return out;
}

// Re-render every few seconds so "12 s ago" labels stay current
export function useTick(ms = 5000) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN(n => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}
