// One-time Google sign-in for the kiosk's calendar and tasks. Run it on a machine
// with a browser (not inside the container):
//
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node server/scripts/google-auth.js
//
// It opens a sign-in link, catches the reply on http://127.0.0.1:8765, prints a
// refresh token to put in .env as GOOGLE_REFRESH_TOKEN, and lists your calendars
// and task lists so you can copy their IDs. Nothing is stored by this script.
import http from 'http';
import crypto from 'crypto';

const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (an OAuth "Desktop app" client).');
  process.exit(1);
}

const PORT = 8765;
const redirect = `http://127.0.0.1:${PORT}`;
const state = crypto.randomBytes(16).toString('hex');
const scopes = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/tasks'];
const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: id,
  redirect_uri: redirect,
  response_type: 'code',
  scope: scopes.join(' '),
  access_type: 'offline',
  prompt: 'consent',
  state
})}`;

console.log('\nOpen this link, sign in with the family Google account and allow access:\n');
console.log(url, '\n');

const server = http.createServer(async (req, res) => {
  const q = new URL(req.url, redirect).searchParams;
  if (q.get('state') !== state || !q.get('code')) {
    res.writeHead(400).end('Unexpected request.');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Signed in. You can close this tab and go back to the terminal.');
  server.close();

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: q.get('code'), client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: 'authorization_code' })
  });
  const tokens = await tokenRes.json();
  if (!tokens.refresh_token) {
    console.error('No refresh token returned:', tokens.error_description || tokens.error || tokens);
    process.exit(1);
  }
  const auth = { Authorization: `Bearer ${tokens.access_token}` };
  const [cals, lists] = await Promise.all([
    fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', { headers: auth }).then(r => r.json()),
    fetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists', { headers: auth }).then(r => r.json())
  ]);

  console.log('Add to .env:\n');
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  console.log('Calendars (GOOGLE_FAMILY_CALENDAR_ID):');
  for (const c of cals.items || []) console.log(`  ${c.summary.padEnd(30)} ${c.id}`);
  console.log('\nTask lists (GOOGLE_TASKS_*):');
  for (const l of lists.items || []) console.log(`  ${l.title.padEnd(30)} ${l.id}`);
});

server.listen(PORT, '127.0.0.1');
