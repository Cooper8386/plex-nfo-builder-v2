import { lstat, readdir, realpath, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { imagePattern, removableType, type RemovableType } from './patterns.js';
import { isWithin } from '../../config/paths.js';

export interface Candidate {
  path: string; type: RemovableType; directory: boolean;
  size: number; mtimeMs: number; ino: number; dev: number;
}
export interface ResetPlan { root: string; files: Candidate[]; skipped: { path: string; reason: string }[] }

export async function previewReset(root: string): Promise<ResetPlan> {
  const canonicalRoot = await realpath(root);
  const plan: ResetPlan = { root: canonicalRoot, files: [], skipped: [] };
  async function walk(folder: string, actors = false): Promise<boolean> {
    let entries;
    try { entries = await readdir(folder, { withFileTypes: true }); }
    catch { plan.skipped.push({ path: folder, reason: 'Unreadable directory' }); return false; }
    let allRemovable = true;
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, entry.name);
      try {
        const stat = await lstat(path);
        if (stat.isSymbolicLink()) {
          plan.skipped.push({ path, reason: 'Symbolic link or junction' }); allRemovable = false; continue;
        }
        if (stat.isDirectory()) {
          const isActors = actors || entry.name.toLowerCase() === '.actors';
          const emptyAfterReset = await walk(path, isActors);
          if (isActors && emptyAfterReset) plan.files.push({ path, type: 'actors', directory: true, ...fingerprint(stat) });
          else allRemovable = false;
          continue;
        }
        const type = actors && imagePattern.test(entry.name) ? 'actors' : removableType(entry.name);
        if (stat.isFile() && type) plan.files.push({ path, type, directory: false, ...fingerprint(stat) });
        else allRemovable = false;
      } catch { plan.skipped.push({ path, reason: 'Cannot inspect file' }); allRemovable = false; }
    }
    return allRemovable;
  }
  await walk(canonicalRoot);
  return plan;
}

function fingerprint(stat: { size: number; mtimeMs: number; ino: number; dev: number }) {
  return { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino, dev: stat.dev };
}

export async function applyReset(plan: ResetPlan, confirm = false, beforeDelete?: (file: Candidate) => Promise<boolean>) {
  if (!confirm) throw new Error('Deletion requires explicit confirmation');
  const removed: string[] = [];
  const skipped = [...plan.skipped];
  for (const file of plan.files) {
    try {
      if (!isWithin(plan.root, file.path) || resolve(file.path) === resolve(plan.root)) throw new Error('Path outside preview root');
      if (beforeDelete && !await beforeDelete(file)) throw new Error('No longer eligible');
      const parent = await realpath(dirname(file.path));
      if (parent !== dirname(file.path) || !isWithin(plan.root, parent)) throw new Error('Parent changed since preview');
      const stat = await lstat(file.path);
      if (stat.isSymbolicLink() || stat.ino !== file.ino || stat.dev !== file.dev || stat.isDirectory() !== file.directory) throw new Error('File replaced since preview');
      if (!file.directory && (!stat.isFile() || stat.size !== file.size || stat.mtimeMs !== file.mtimeMs)) throw new Error('File changed since preview');
      if (file.directory) {
        await rmdir(file.path); // Never recursive: a new or unrecognized file protects its directory.
      }
      else {
        const actorImage = file.type === 'actors' && file.path.split(/[\\/]/).some(p => p.toLowerCase() === '.actors') && imagePattern.test(basename(file.path));
        if (!actorImage && !removableType(basename(file.path))) throw new Error('Unrecognized file');
        await unlink(file.path);
      }
      removed.push(file.path);
    } catch (error) { skipped.push({ path: file.path, reason: (error as Error).message }); }
  }
  return { removed, skipped };
}
