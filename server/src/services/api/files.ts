import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { isWithin, mediaPath } from '../../config/paths.js';

export async function browse(root: string, path = '.') {
  const base = await mediaPath(root, '.'), folder = await mediaPath(base, path);
  const items: { name: string; path: string; is_dir: boolean; size: number | null }[] = [];
  if ((await lstat(folder)).isDirectory()) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      try {
        const child = join(folder, entry.name), info = await lstat(child);
        if (info.isSymbolicLink() || !info.isDirectory() && !info.isFile()) continue;
        const canonical = await mediaPath(base, child);
        items.push({ name: entry.name, path: canonical, is_dir: info.isDirectory(), size: info.isFile() ? info.size : null });
      } catch { /* An inaccessible or moved entry is not a usable browse target. */ }
    }
    items.sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }
  return { path: folder, parent: relative(base, folder) ? dirname(folder) : null, items };
}

function redact(text: string) {
  return text.replace(/("(?:x-api-token|api_token)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[REDACTED]"')
    .replace(/(api_token=)[^&\s"'\\]+/gi, '$1[REDACTED]')
    .replace(/(\bX-API-Token\b["']?\s*[:=]\s*["']?)[^\s"',}\\]+/gi, '$1[REDACTED]')
    .replace(/(\bBearer\s+)[^\s"',}\\]+/gi, '$1[REDACTED]');
}

async function openLog(configDir: string, name: string) {
  const root = await realpath(configDir), path = join(root, 'logs', name), info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('API validation: Log must be a regular file');
  const canonical = await realpath(path);
  if (!isWithin(root, canonical) || relative(path, canonical)) throw new Error('API validation: Log must be a regular file inside logs');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.ino !== info.ino || opened.dev !== info.dev) throw new Error('API validation: Log changed while opening');
    return file;
  } catch (error) { await file.close(); throw error; }
}

export async function appLog(configDir: string, tail = 500): Promise<{ lines: string[] }> {
  const count = Number.isFinite(tail) ? Math.min(10000, Math.max(0, Math.trunc(tail))) : 500;
  if (!count) return { lines: [] };
  let file;
  try { file = await openLog(configDir, 'app.log'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { lines: [] }; throw error; }
  try {
    let position = (await file.stat()).size, newlineCount = 0;
    const minimum = Math.max(0, position - 4 * 1024 * 1024), chunks: Buffer[] = [];
    // Read backwards in chunks; huge or malformed single-line logs cannot exhaust memory.
    while (position > minimum && newlineCount <= count) {
      const size = Math.min(64 * 1024, position - minimum); position -= size;
      const buffer = Buffer.alloc(size), { bytesRead } = await file.read(buffer, 0, size, position);
      const chunk = buffer.subarray(0, bytesRead); chunks.push(chunk);
      for (const byte of chunk) if (byte === 10) newlineCount++;
    }
    const lines = Buffer.concat(chunks.reverse()).toString('utf8').split(/\r?\n/);
    if (position > 0) lines.shift();
    if (lines.at(-1) === '') lines.pop();
    return { lines: lines.slice(-count).map(redact) };
  } finally { await file.close(); }
}

export async function jobLog(configDir: string, id: string): Promise<string> {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error('API validation: Invalid job ID');
  const file = await openLog(configDir, join('jobs', `${id}.log`));
  try { return redact(await file.readFile('utf8')); } finally { await file.close(); }
}
