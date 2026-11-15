import { execFile } from 'child_process';
import { promisify } from 'util';
import { get } from '../lib/http.js';
import { cached } from '../lib/cache.js';

const run = promisify(execFile);

// Local clones are mounted read-only. --no-optional-locks stops git from
// writing the index; safe.directory because the owner uid differs.
async function git(path, args) {
  const { stdout } = await run('git', ['-c', 'safe.directory=*', '--no-optional-locks', '-C', path, ...args], { timeout: 5000 });
  return stdout.trim();
}

async function local(repo) {
  const branch = await git(repo.path, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = await git(repo.path, ['rev-parse', 'HEAD']);
  const porcelain = await git(repo.path, ['status', '--porcelain']);
  const dirty = porcelain ? porcelain.split('\n').length : 0;
  let ahead = null;
  let tracking = null;
  try {
    tracking = await git(repo.path, ['rev-parse', '@{u}']);
    ahead = Number(await git(repo.path, ['rev-list', '--count', '@{u}..HEAD']));
  } catch { /* no upstream */ }
  return { branch, head, dirty, ahead, tracking };
}

async function remote(repo, branch, token) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'home-dashboard' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const [info, br] = await Promise.all([
    get(`https://api.github.com/repos/${repo.github}`, { headers }),
    get(`https://api.github.com/repos/${repo.github}/branches/${encodeURIComponent(branch)}`, { headers }).catch(() => null)
  ]);
  return { pushedAt: info.pushed_at, sha: br?.commit?.sha || null, exists: !!br };
}

export function getRepos(config) {
  if (!config.repos.length) return null;
  // GitHub allows 60 unauthenticated calls an hour, so check every 10 minutes
  return cached('repos', async () => Promise.all(config.repos.map(async repo => {
    try {
      const l = await local(repo);
      const r = repo.github ? await remote(repo, l.branch, config.sources.github?.token).catch(e => ({ error: e.message })) : null;

      let state = 'Up to date';
      let level = 'ok';
      if (l.dirty) { state = `${l.dirty} uncommitted`; level = 'warn'; }
      else if (r && !r.error && !r.exists) { state = 'Branch not on GitHub'; level = 'warn'; }
      else if (r?.sha && r.sha !== l.head && l.ahead > 0) { state = `${l.ahead} to push`; level = 'warn'; }
      else if (r?.sha && r.sha !== l.head && r.sha !== l.tracking) { state = 'GitHub has newer commits'; level = 'warn'; }
      else if (l.ahead > 0) { state = `${l.ahead} to push`; level = 'warn'; }
      else if (r?.error) { state = 'GitHub not reachable'; level = 'unknown'; }

      return { name: repo.name, branch: l.branch, lastPush: r?.pushedAt || null, dirty: l.dirty, ahead: l.ahead, state, level };
    } catch (error) {
      return { name: repo.name, state: 'Not readable', level: 'unknown', error: error.message };
    }
  })), 10 * 60 * 1000);
}
