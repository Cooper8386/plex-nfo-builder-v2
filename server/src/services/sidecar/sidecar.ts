import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { atomicWrite } from '../fs/atomic.js';
import { getBinding, restoreSnapshot } from '../../db/queries.js';
import { sidecarSchema, type Sidecar } from './format.js';

export const sidecarName = '.plex-nfo-builder.json';

export async function readSidecar(folder: string): Promise<Sidecar | null> {
  let raw: string;
  try { raw = await readFile(join(folder, sidecarName), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const parsed = sidecarSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

export async function writeSidecar(folder: string, data: Sidecar) {
  const valid = sidecarSchema.parse(data);
  await atomicWrite(join(folder, sidecarName), `${JSON.stringify(valid, null, 2)}\n`);
}

// This is the recovery hook for the phase 8 scanner. Reading media remains asynchronous.
export async function recoverSidecar(db: Database.Database, folder: string) {
  if (getBinding(db, folder)) return false;
  const data = await readSidecar(folder);
  return data ? restoreSnapshot(db, folder, data, true) : false;
}
