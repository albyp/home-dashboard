import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../sources/solar.js';
import { demoForecast } from '../demo.js';

// A time of day, local to the forecast
function at(res, hm, dayOffset = 0) {
  const date = res.daily.time[dayOffset];
  return Date.parse(`${date}T${hm}:00Z`) - res.utc_offset_seconds * 1000;
}

test('finds the strong-sun window and labels hours by their start', () => {
  const res = demoForecast();
  const r = analyse(res, {}, at(res, '12:20'));
  assert.equal(r.today.sunrise, '06:00');
  assert.equal(r.today.sunset, '19:30');
  assert.equal(r.today.solarNoon, '12:45');
  assert.ok(r.today.window, 'a sunny day has a window');
  assert.ok(r.today.window.start < '12:00' && r.today.window.end > '12:00');
  assert.equal(r.today.hours[0].hour, 6); // 06:00–07:00 is the first lit hour
  assert.equal(r.current.w, r.today.hours.find(h => h.hour === 12).w);
});

test('state follows the time of day', () => {
  const res = demoForecast();
  const w = analyse(res).today.window;
  const before = h => `${String(Number(h.slice(0, 2)) - 1).padStart(2, '0')}:30`;
  assert.equal(analyse(res, {}, at(res, '05:30')).state, 'before');
  assert.equal(analyse(res, {}, at(res, before(w.start))).state, 'later');
  assert.equal(analyse(res, {}, at(res, '12:00')).state, 'now');
  assert.equal(analyse(res, {}, at(res, w.end)).state, 'past');
  assert.equal(analyse(res, {}, at(res, '20:00')).state, 'night');
});

test('a dull day has no window', () => {
  const res = demoForecast();
  res.hourly.shortwave_radiation = res.hourly.shortwave_radiation.map(v => Math.round(v * 0.3));
  const r = analyse(res, {}, at(res, '11:00'));
  assert.equal(r.today.window, null);
  assert.equal(r.state, 'low');
});

test('estimate needs a panel size; feed-in peak is passed through', () => {
  const res = demoForecast();
  assert.equal(analyse(res).today.estimateKwh, null);
  const r = analyse(res, { systemKw: 6.6, feedInPeak: '15:00-21:00' });
  assert.ok(r.today.estimateKwh > 20 && r.today.estimateKwh < 45, `got ${r.today.estimateKwh}`);
  assert.deepEqual(r.feedInPeak, ['15:00', '21:00']);
  // Unset or malformed ${VAR}s are ignored
  assert.equal(analyse(res, { feedInPeak: '' }).feedInPeak, null);
  assert.equal(analyse(res, { feedInPeak: '9pm-3pm' }).feedInPeak, null);
  assert.ok(r.tomorrow.kwhPerM2 < r.today.kwhPerM2, 'tomorrow is cloudier');
});
