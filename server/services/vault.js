import fs from 'fs/promises';
import path from 'path';

// Today's activity in the Albyte vault (mounted read-only). A note is "new" when its
// frontmatter `date:` is today (the vault's creation-date convention); otherwise a
// note modified today is "updated". Day boundaries follow the container's TZ.
const VAULT_DIR = () => process.env.VAULT_DIR || '/vault';
const SKIP_DIRS = new Set(['.obsidian', '.stfolder', '.stversions', '.trash', '.git']);
const CACHE_MS = 60 * 1000;
let cache = null;

function localDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function walk(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith('.md')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

async function frontmatterDate(file) {
  const fh = await fs.open(file, 'r');
  try {
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(600), 0, 600, 0);
    const head = buffer.subarray(0, bytesRead).toString('utf8');
    if (!head.startsWith('---')) return null;
    return head.match(/^date:\s*["']?(\d{4}-\d{2}-\d{2})/m)?.[1] || null;
  } finally {
    await fh.close();
  }
}

export async function getVaultInfo() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const root = VAULT_DIR();
  try {
    const files = await walk(root);
    const today = localDate(new Date());
    const touched = [];
    for (const file of files) {
      const stat = await fs.stat(file);
      if (localDate(stat.mtime) !== today) continue;
      const created = await frontmatterDate(file).catch(() => null);
      const rel = path.relative(root, file);
      touched.push({
        path: rel,
        folder: rel.includes(path.sep) ? rel.split(path.sep)[0] : '',
        title: path.basename(file, '.md'),
        kind: created === today ? 'new' : 'updated',
        modified: stat.mtime.toISOString()
      });
    }
    touched.sort((a, b) => b.modified.localeCompare(a.modified));
    const data = {
      reachable: true,
      notes: files.length,
      today,
      newCount: touched.filter(t => t.kind === 'new').length,
      updatedCount: touched.filter(t => t.kind === 'updated').length,
      recent: touched.slice(0, 8)
    };
    cache = { at: Date.now(), data };
    return data;
  } catch (error) {
    return { reachable: false, error: error.code === 'ENOENT' ? `vault not mounted at ${root}` : error.message };
  }
}
