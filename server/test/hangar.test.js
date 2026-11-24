import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hangarIssues, hangarExtras } from '../sources/hangar.js';

const NOW = Date.parse('2026-11-24T08:00:00+08:00');
const iso = minutesAgo => new Date(NOW - minutesAgo * 60000).toISOString();

function status(over = {}) {
  return {
    updated: iso(0.2),
    mode: 'benchmark',
    workers: {
      tiny: { queued: 0, running: 0, done: 2, failed: 0, current: null, last_finished: iso(90), last_error: null },
      rocky: { queued: 2, running: 0, done: 0, failed: 0, current: null, last_finished: null, last_error: null }
    },
    ...over
  };
}
const opts = { now: NOW, sleepy: ['rocky', 'rocky-1'] };

test('healthy: nothing raised, rocky queued while asleep is expected', () => {
  assert.deepEqual(hangarIssues(status(), opts), []);
});

test('status older than 2 minutes means Hangar is down (and nothing else)', () => {
  const r = hangarIssues(status({ updated: iso(3) }), opts);
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'Hangar is down');
  assert.equal(r[0].level, 'bad');
  assert.equal(hangarIssues(null, opts)[0].title, 'Hangar is down');
});

test('failed jobs on any worker are raised', () => {
  const s = status();
  s.workers.rocky.failed = 1;
  s.workers.rocky.last_error = 'CUDA out of memory';
  const r = hangarIssues(s, opts);
  assert.equal(r.length, 1);
  assert.match(r[0].title, /1 failed job on rocky/);
  assert.equal(r[0].detail, 'CUDA out of memory');
});

test('the page lists workers and recent recordings, and never prints text beyond counts', () => {
  const h = {
    updated: new Date().toISOString(), mode: 'benchmark', recordings: { total: 2, audio_minutes: 1.4, latest: '2026-11-24T06:14' },
    workers: [{ name: 'tiny', queued: 0, running: 0, done: 2, failed: 0 }, { name: 'rocky', queued: 2, running: 0, done: 0, failed: 0 }],
    outputs: { transcripts: { ok: 6, failed: 0 } }, rocky: { state: 'offline', reasons: ['ConnectTimeout'] },
    recent: [{ recorded: '2026-11-24T06:14', duration_s: 6, runs: { tiny: 'done', rocky: 'queued' } }], issues: []
  };
  const cards = hangarExtras(h);
  assert.deepEqual(cards.map(c => c.title), ['Workers · benchmark mode', 'Recordings', 'Rocky agent (GPU)', 'Last recordings']);
  assert.equal(cards[0].rows[2].level, 'off');                       // rocky queued, asleep: grey
  assert.equal(cards[3].rows[0].value, 'tiny done · rocky queued');
  assert.equal(hangarExtras({ error: 'no status file yet' })[0].empty, 'no status file yet');
});

test('tiny with queued work and nothing finished for an hour is stuck', () => {
  const s = status();
  s.workers.tiny.queued = 1;
  assert.match(hangarIssues(s, opts)[0].title, /Hangar on tiny is stuck/);
  s.workers.tiny.last_finished = iso(20);          // finished recently: fine
  assert.deepEqual(hangarIssues(s, opts), []);
  s.workers.tiny.last_finished = null;             // never finished anything: stuck
  assert.match(hangarIssues(s, opts)[0].title, /stuck/);
});
