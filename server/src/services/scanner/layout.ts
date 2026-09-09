import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ItemKind } from 'shared';

export const videoPattern = /\.(mkv|mp4|avi|mov|m4v|wmv|ts|m2ts|mpg|mpeg|webm|flv|vob)$/i;
export function seasonNumber(name: string): number | null {
  if (/^specials$/i.test(name)) return 0;
  const match = /^season[ ._-]*(\d+)\b/i.exec(name);
  return match ? Number(match[1]) : null;
}
export async function detectKind(folder: string): Promise<ItemKind> {
  const entries = await readdir(folder, { withFileTypes: true });
  if (entries.some(entry => entry.isDirectory() && seasonNumber(entry.name) !== null)) return 'series';
  if (entries.some(entry => entry.isFile() && videoPattern.test(entry.name) && /s\d+e\d+|\[.*?\].*? - \d+|\d{4}[.-]\d{2}[.-]\d{2}/i.test(entry.name))) return 'series';
  return 'movie';
}
export async function mediaFolders(folder: string) {
  const entries = await readdir(folder, { withFileTypes: true });
  return [{ path: folder, season: null as number | null }, ...entries.filter(entry => entry.isDirectory() && seasonNumber(entry.name) !== null)
    .map(entry => ({ path: join(folder, entry.name), season: seasonNumber(entry.name) }))];
}
