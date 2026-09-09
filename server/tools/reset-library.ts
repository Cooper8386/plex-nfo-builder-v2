import { lstat, readdir, realpath, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { imagePattern, removableType, type RemovableType } from '../src/services/cleaner/patterns.js';
import { isWithin } from '../src/config/paths.js';

interface Candidate {
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

export async function applyReset(plan: ResetPlan, confirm = false) {
  if (!confirm) throw new Error('Deletion requires explicit confirmation');
  const removed: string[] = [];
  const skipped = [...plan.skipped];
  for (const file of plan.files) {
    try {
      if (!isWithin(plan.root, file.path) || resolve(file.path) === resolve(plan.root)) throw new Error('Path outside preview root');
      const parent = await realpath(dirname(file.path));
      if (parent !== dirname(file.path) || !isWithin(plan.root, parent)) throw new Error('Parent changed since preview');
      const stat = await lstat(file.path);
      if (stat.isSymbolicLink() || stat.ino !== file.ino || stat.dev !== file.dev || stat.isDirectory() !== file.directory) throw new Error('File replaced since preview');
      if (!file.directory && (!stat.isFile() || stat.size !== file.size || stat.mtimeMs !== file.mtimeMs)) throw new Error('File changed since preview');
      if (file.directory) await rmdir(file.path); // Never recursive: a new or unrecognized file protects its directory.
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

export async function runResetCli(args: string[]) {
  const { values } = parseArgs({ args, options: { 'media-root': { type: 'string' }, confirm: { type: 'boolean', default: false }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('Usage: pnpm reset-library --media-root <path> [--confirm]\nDry-run by default. At cutover only: --confirm deletes all NFOs, sidecars, and standard artwork.');
    return;
  }
  const root = values['media-root'] || process.env.MEDIA_ROOT;
  if (!root) throw new Error('Specify --media-root or MEDIA_ROOT');
  const plan = await previewReset(root);
  console.log(`Reset preview: ${plan.root}`);
  for (const type of ['sidecar', 'nfo', 'artwork', 'thumbnail', 'actors'] as const) {
    const files = plan.files.filter(f => f.type === type);
    console.log(`${type}: ${files.length}`);
    for (const file of files) console.log(`  ${file.path}`);
  }
  for (const item of plan.skipped) console.error(`Skipped ${item.path}: ${item.reason}`);
  if (values.confirm) {
    const result = await applyReset(plan, true);
    console.log(`Removed: ${result.removed.length}; skipped: ${result.skipped.length}`);
    for (const item of result.skipped.slice(plan.skipped.length)) console.error(`Skipped ${item.path}: ${item.reason}`);
    if (result.skipped.length) process.exitCode = 1;
  } else console.log('Dry-run only. No files deleted. Pass --confirm to delete at cutover.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runResetCli(process.argv.slice(2)).catch(error => { console.error((error as Error).message); process.exitCode = 1; });
}
