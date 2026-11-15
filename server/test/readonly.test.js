import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { write, allowWrite, clearAllowList, RefusedError } from '../lib/http.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ['node_modules', 'test', 'public', 'scripts'].includes(e.name) ? [] : sourceFiles(p);
    return p.endsWith('.js') ? [p] : [];
  });
}

test('only lib/http.js calls fetch()', () => {
  const offenders = sourceFiles(root)
    .filter(f => !f.endsWith(path.join('lib', 'http.js')))
    .filter(f => /\bfetch\s*\(/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('only actions.js asks for writes', () => {
  const offenders = sourceFiles(root)
    .filter(f => !f.endsWith(path.join('snapshot', 'actions.js')) && !f.endsWith(path.join('lib', 'http.js')))
    .filter(f => /\b(write|allowWrite)\s*\(/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('writes off the allow-list are refused before any request', () => {
  clearAllowList();
  assert.throws(() => write('POST', 'http://127.0.0.1:8123/api/services/lock/unlock'), RefusedError);
  assert.throws(() => write('DELETE', 'http://127.0.0.1:8123/api/states/x'), RefusedError);
});

test('allow-list matches exact paths and one trailing segment', async () => {
  clearAllowList();
  allowWrite('POST', 'http://127.0.0.1:8123/api/services/light/toggle');
  allowWrite('PATCH', 'https://tasks.googleapis.com/tasks/v1/lists/abc/tasks/*');
  const refused = (m, u) => { try { write(m, u).catch(() => {}); return false; } catch (e) { return e instanceof RefusedError; } };
  assert.equal(refused('POST', 'http://127.0.0.1:8123/api/services/light/toggle'), false);
  assert.equal(refused('POST', 'http://127.0.0.1:8123/api/services/light/turn_off'), true);
  assert.equal(refused('PATCH', 'https://tasks.googleapis.com/tasks/v1/lists/abc/tasks/t1'), false);
  assert.equal(refused('PATCH', 'https://tasks.googleapis.com/tasks/v1/lists/abc/tasks/t1/move'), true);
  assert.equal(refused('PATCH', 'https://tasks.googleapis.com/tasks/v1/lists/other/tasks/t1'), true);
  clearAllowList();
});
