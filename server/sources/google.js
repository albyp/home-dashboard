import { get, login } from '../lib/http.js';
import { cached } from '../lib/cache.js';

// One Google account, offline access. Get the refresh token once with
// `node server/scripts/google-auth.js`. Scopes: calendar.readonly, tasks.
let token = { value: null, expires: 0 };

export function googleConfigured(config) {
  const g = config.sources.google;
  return !!(g?.client_id && g?.client_secret && g?.refresh_token);
}

// The token refresh is a POST, but it only fetches an access token
export async function accessToken(config) {
  if (token.value && Date.now() < token.expires - 60000) return token.value;
  const g = config.sources.google;
  const res = await login('https://oauth2.googleapis.com/token', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: g.client_id,
      client_secret: g.client_secret,
      refresh_token: g.refresh_token,
      grant_type: 'refresh_token'
    })
  });
  token = { value: res.access_token, expires: Date.now() + res.expires_in * 1000 };
  return token.value;
}

const auth = async config => ({ Authorization: `Bearer ${await accessToken(config)}` });

function dayBounds(offsetDays) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

export function calendar(config) {
  const cals = (config.kiosk.calendars || []).filter(c => c.id);
  if (!googleConfigured(config) || !cals.length) return null;
  return cached('google:calendar', async () => {
    const headers = await auth(config);
    const timeMin = dayBounds(0).toISOString();
    const timeMax = dayBounds(2).toISOString();
    const lists = await Promise.all(cals.map(c => get(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events?singleEvents=true&orderBy=startTime&maxResults=25&timeMin=${timeMin}&timeMax=${timeMax}`,
      { headers }
    )));
    return lists.flatMap(l => l.items || [])
      .filter(e => e.status !== 'cancelled')
      .map(e => ({
        id: e.id,
        title: e.summary || '(no title)',
        location: e.location || null,
        allDay: !!e.start?.date,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date
      }))
      .sort((a, b) => new Date(a.start) - new Date(b.start));
  }, 5 * 60 * 1000);
}

export const TASKS_BASE = 'https://tasks.googleapis.com/tasks/v1/lists';

export function tasks(config) {
  const lists = (config.kiosk.taskLists || []).filter(l => l.id);
  if (!googleConfigured(config) || !lists.length) return null;
  return cached('google:tasks', async () => {
    const headers = await auth(config);
    // Show open tasks, plus ones finished today so a tick doesn't vanish at once
    const completedMin = dayBounds(0).toISOString();
    return Promise.all(lists.map(async list => {
      const res = await get(
        `${TASKS_BASE}/${encodeURIComponent(list.id)}/tasks?showCompleted=true&showHidden=true&completedMin=${completedMin}&maxResults=50`,
        { headers }
      );
      const open = await get(`${TASKS_BASE}/${encodeURIComponent(list.id)}/tasks?showCompleted=false&maxResults=50`, { headers });
      const byId = new Map([...(open.items || []), ...(res.items || [])].map(t => [t.id, t]));
      return {
        id: list.id,
        name: list.name,
        items: [...byId.values()]
          .filter(t => t.title)
          .map(t => ({ id: t.id, title: t.title, due: t.due || null, done: t.status === 'completed', completedAt: t.completed || null }))
          .sort((a, b) => Number(a.done) - Number(b.done) || (a.due || '9').localeCompare(b.due || '9'))
      };
    }));
  }, 60 * 1000);
}
