import express from 'express';
import http from 'http';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { authRouter, requireLogin, sessionRole } from './auth.js';
import { loadConfig, isDemo } from './config.js';
import { registerAllowList } from './snapshot/actions.js';
import apiRouter from './routes/api.js';
import betbotRouter from './routes/betbot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3001;
// Loopback only: remote access goes through `tailscale serve` (HTTPS, tailnet only)
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, 'public');

registerAllowList(loadConfig());

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
  });
  next();
});

app.use(authRouter());
app.use(requireLogin);
app.use('/api', apiRouter);
app.use(betbotRouter());

app.use(express.static(PUBLIC_DIR, { index: false }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), err => err && next());
});

app.listen(PORT, HOST, () => {
  console.log(`home-dashboard on ${HOST}:${PORT}${isDemo() ? ' (demo data)' : ''}`);
});

// Old links (http://<host>:3001/...) reach this through `tailscale serve --http=3001`
// and are sent to the HTTPS address. The host is fixed, so it can't redirect anywhere else.
const { PUBLIC_URL, REDIRECT_PORT } = process.env;
if (PUBLIC_URL && REDIRECT_PORT) {
  http.createServer((req, res) => {
    res.writeHead(301, { Location: `${PUBLIC_URL.replace(/\/$/, '')}${req.url}` });
    res.end();
  }).listen(REDIRECT_PORT, HOST);
}

export { sessionRole };
