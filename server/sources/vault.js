import fs from 'fs/promises';
import path from 'path';
import { cached } from '../lib/cache.js';

// "Albyte today": notes written in the vault today (mounted read-only). A note is new
// when its frontmatter `date:` is today (the vault's creation-date convention);
// otherwise a note modified today is updated. Day boundaries follow the container's TZ.
const SKIP_DIRS = new Set(['.obsidian', '.stfolder', '.stversions', '.trash', '.git']);

function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
    return head.startsWith('---') ? head.match(/^date:\s*["']?(\d{4}-\d{2}-\d{2})/m)?.[1] || null : null;
  } finally {
    await fh.close();
  }
}

// Admin overview only. Never sent to the kiosk.
export function vaultToday(config) {
  const src = config.sources.vault;
  if (!src?.path) return null;
  return cached('vault', async () => {
    const files = await walk(src.path);
    const today = localDate(new Date());
    const touched = [];
    for (const file of files) {
      const stat = await fs.stat(file);
      if (localDate(stat.mtime) !== today) continue;
      const created = await frontmatterDate(file).catch(() => null);
      const rel = path.relative(src.path, file);
      touched.push({
        title: path.basename(file, '.md'),
        folder: rel.includes(path.sep) ? rel.split(path.sep)[0] : '',
        kind: created === today ? 'new' : 'updated',
        modified: stat.mtime.toISOString()
      });
    }
    touched.sort((a, b) => b.modified.localeCompare(a.modified));
    return {
      label: src.label || 'Vault',
      notes: files.length,
      newCount: touched.filter(t => t.kind === 'new').length,
      updatedCount: touched.filter(t => t.kind === 'updated').length,
      recent: touched.slice(0, 8)
    };
  }, 60 * 1000);
}
