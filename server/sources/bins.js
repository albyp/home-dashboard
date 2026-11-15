// Bin night from a fixed schedule in dashboard.yaml. No network calls.
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function nextCollection(cfg, now = new Date()) {
  const day = DAYS.indexOf(String(cfg.day || '').toLowerCase());
  if (day < 0) return null;
  const today = startOfDay(now);
  const date = new Date(today);
  date.setDate(date.getDate() + ((day - today.getDay() + 7) % 7));
  // After midday on collection day, show next week's
  if (date.getTime() === today.getTime() && now.getHours() >= 12) date.setDate(date.getDate() + 7);

  const weeksBetween = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / (7 * 86400000));
  const streams = (cfg.streams || []).filter(s => {
    const every = s.every || 1;
    if (every === 1 || !s.anchor) return true;
    return ((weeksBetween(date, new Date(`${s.anchor}T12:00:00`)) % every) + every) % every === 0;
  }).map(s => ({ name: s.name, colour: s.colour || 'grey' }));

  // "Tonight" from showFrom (e.g. 15:00) the day before, until the morning of collection
  const [h, m] = String(cfg.showFrom || '15:00').split(':').map(Number);
  const showAt = new Date(date);
  showAt.setDate(showAt.getDate() - 1);
  showAt.setHours(h, m || 0, 0, 0);
  const endAt = new Date(date);
  endAt.setHours(9, 0, 0, 0);

  const isToday = date.getTime() === today.getTime();
  return {
    date: date.toLocaleDateString('en-CA'),
    weekday: DAYS[day],
    tonight: now >= showAt && now < endAt,
    isToday,
    streams
  };
}

export function bins(config) {
  const cfg = config.kiosk.bins;
  if (!cfg) return null;
  return nextCollection(cfg);
}
