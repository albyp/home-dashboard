import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextCollection } from '../sources/bins.js';

const cfg = {
  day: 'tuesday',
  showFrom: '15:00',
  streams: [
    { name: 'General waste', every: 1 },
    { name: 'Recycling', every: 2, anchor: '2026-11-17' },
    { name: 'Garden', every: 2, anchor: '2026-11-24' }
  ]
};
const names = r => r.streams.map(s => s.name);

test('Monday evening shows tomorrow\'s bins as tonight', () => {
  const r = nextCollection(cfg, new Date(2026, 10, 16, 18, 0));
  assert.equal(r.date, '2026-11-17');
  assert.equal(r.tonight, true);
  assert.deepEqual(names(r), ['General waste', 'Recycling']);
});

test('alternating weeks', () => {
  const r = nextCollection(cfg, new Date(2026, 10, 20, 10, 0));
  assert.equal(r.date, '2026-11-24');
  assert.equal(r.tonight, false);
  assert.deepEqual(names(r), ['General waste', 'Garden']);
});

test('after midday on collection day it moves to next week', () => {
  const r = nextCollection(cfg, new Date(2026, 10, 17, 13, 0));
  assert.equal(r.date, '2026-11-24');
});
