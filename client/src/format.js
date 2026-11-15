export function bytes(n, digits = 1) {
  if (n == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i < 2 ? 0 : n >= 100 ? 0 : digits)} ${units[i]}`;
}

// "used / total GB" with one shared unit
export function usedOf(used, total) {
  if (used == null || total == null) return '—';
  const tb = total >= 1000 * 1024 ** 3;
  const div = tb ? 1024 ** 4 : 1024 ** 3;
  const unit = tb ? 'TB' : 'GB';
  const fmt = v => (v / div >= 100 ? Math.round(v / div) : Math.round((v / div) * 10) / 10);
  return `${fmt(used)} / ${fmt(total)} ${unit}`;
}

export function ago(iso) {
  if (!iso) return null;
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function duration(seconds) {
  if (seconds == null) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return d ? `${d} d` : `${h} h`;
}

// "since 10:18", "since Thu", "since 12 Nov"
export function since(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const days = (now - d) / 86400000;
  if (d.toDateString() === now.toDateString()) return `since ${d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  if (days < 6) return `since ${d.toLocaleDateString('en-AU', { weekday: 'short' })}`;
  return `since ${d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`;
}

export function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.toDateString() === now.toDateString()) return `today ${time}`;
  const days = (now - d) / 86400000;
  if (days < 6) return `${d.toLocaleDateString('en-AU', { weekday: 'short' })} ${time}`;
  return ago(iso);
}

export const pct = v => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`);
export const n = v => (v == null ? '—' : v.toLocaleString('en-AU'));
