import { lstat, readdir, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { isWithin } from '../../config/paths.js';
import { forgetFolder } from '../../db/queries.js';
import { videoPattern } from '../scanner/layout.js';
import { previewClean } from './cleaner.js';
import { applyReset, type ResetPlan } from './files.js';

export interface PrunePlan {
  root: string;
  empty: boolean;
  deleteFiles: boolean;
  folders: { folder: string; files?: ResetPlan }[];
}

// A missing leaf still needs its nearest existing parent's canonical boundary checked.
async function checkedPath(root: string, folder: string) {
  const target = resolve(folder);
  if (!relative(root, target) || !isWithin(root, target)) throw new Error('Prune path outside media root');
  let ancestor = target;
  for (;;) {
    try {
      const info = await lstat(ancestor);
      if (ancestor === target && info.isSymbolicLink()) throw new Error('Prune refuses symlink folders');
      if (!isWithin(root, await realpath(ancestor))) throw new Error('Prune path outside media root');
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor || !isWithin(root, parent)) throw new Error('Prune path outside media root',{cause:error});
      ancestor = parent;
    }
  }
}

// Unknown entries, links and unreadable directories are protected like live video.
async function hasVideo(folder: string): Promise<boolean> {
  try {
    const info = await lstat(folder);
    if (!info.isDirectory() || info.isSymbolicLink()) return true;
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) return true;
      if (entry.isDirectory()) { if (await hasVideo(join(folder, entry.name))) return true; }
      else if (!entry.isFile() || videoPattern.test(entry.name)) return true;
    }
    return false;
  } catch { return true; }
}

async function eligible(root: string, folder: string, empty: boolean) {
  await checkedPath(root, folder);
  if (empty) return !(await hasVideo(folder));
  try { await lstat(folder); return false; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error; }
}

export async function previewPrune(db: Database.Database, root: string, options: { library?: string; empty?: boolean; deleteFiles?: boolean } = {}): Promise<PrunePlan> {
  const plan: PrunePlan = { root: await realpath(root), empty: options.empty ?? false, deleteFiles: options.deleteFiles ?? false, folders: [] };
  const rows = db.prepare('SELECT folder_path FROM item_state WHERE (? IS NULL OR library=?) ORDER BY folder_path').all(options.library ?? null, options.library ?? null) as { folder_path: string }[];
  for (const row of rows) {
    try {
      if (!(await eligible(plan.root, row.folder_path, plan.empty))) continue;
      const files = plan.empty && plan.deleteFiles ? await previewClean(row.folder_path, false) : undefined;
      plan.folders.push({ folder: row.folder_path, ...(files ? { files } : {}) });
    } catch { /* An uncertain filesystem state must never authorize pruning. */ }
  }
  return plan;
}

export async function applyPrune(db: Database.Database, plan: PrunePlan, confirm = false) {
  if (confirm !== true) throw new Error('Danger validation: Explicit confirmation required');
  const result = { removed: [] as string[], skipped: [] as { path: string; reason: string }[] };
  const currentRoot = await realpath(plan.root);
  if (!isWithin(plan.root, currentRoot)) throw new Error('Prune media root changed');
  for (const entry of plan.folders) {
    try {
      const recheck = () => eligible(plan.root, entry.folder, plan.empty).catch(() => false);
      if (!(await recheck())) { result.skipped.push({ path: entry.folder, reason: 'Folder reappeared, contains media, or cannot be safely inspected' }); continue; }
      if (plan.empty && plan.deleteFiles && entry.files) {
        const cleaned = await applyReset(entry.files, true, recheck);
        result.skipped.push(...cleaned.skipped);
      }
      if (!(await recheck())) { result.skipped.push({ path: entry.folder, reason: 'Folder changed during pruning; database state retained' }); continue; }
      forgetFolder(db, entry.folder);
      result.removed.push(entry.folder);
    } catch (error) { result.skipped.push({ path: entry.folder, reason: error instanceof Error ? error.message : 'Prune failed' }); }
  }
  return result;
}
