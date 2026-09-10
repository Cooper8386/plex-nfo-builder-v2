import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';

const previews = new Map<string, { key: string; expires: number; value: unknown }>();
export function capturePreview<T>(key: string, value: T): string {
  for (const [id, entry] of previews) if (entry.expires < Date.now()) previews.delete(id);
  if (previews.size >= 100) previews.delete(previews.keys().next().value!);
  const id = randomUUID();
  previews.set(id, { key, expires: Date.now() + 30 * 60_000, value });
  return id;
}
export function consumePreview<T>(key: string, id?: string, confirm?: boolean): T {
  const entry = id ? previews.get(id) : undefined;
  if (confirm !== true || !entry || entry.key !== key || entry.expires < Date.now()) {
    throw new Error('Danger validation: Confirmation and a current preview are required. Preview again.');
  }
  previews.delete(id!);
  return entry.value as T;
}
export async function fileStamp(path: string) {
  const parent = dirname(path);
  if (await realpath(parent) !== parent) throw new Error('Danger validation: File parent changed. Preview again.');
  const [file, directory] = await Promise.all([lstat(path), lstat(parent)]);
  if (!file.isFile() || file.isSymbolicLink()) throw new Error('Danger validation: Expected a regular file. Preview again.');
  return JSON.stringify([file.dev, file.ino, file.size, file.mtimeMs, file.ctimeMs, directory.dev, directory.ino]);
}
export async function checkFile(path: string, stamp: string) {
  if (await fileStamp(path) !== stamp) throw new Error('Danger validation: File changed since preview. Preview again.');
}
