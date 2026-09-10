import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { isWithin } from '../../config/paths.js';
import { filterCast } from '../nfo/cast.js';
import type { Cast } from '../providers/normalized.js';

export function actorFilename(name: string): string {
  const sanitized = Array.from(name, character => {
    const code = character.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159) || '<>:"|?*/\\'.includes(character) ? '_' : character;
  }).join('');
  return `${sanitized || 'unknown'}.jpg`;
}

export async function downloadActors(
  folder: string,
  cast: Cast[],
  download: (url: string, path: string) => Promise<void>,
): Promise<{ downloaded: string[]; failed: string[] }> {
  const seen = new Set<string>();
  const portraits = filterCast(cast).flatMap(person => {
    const filename = actorFilename(person.name);
    const key = filename.normalize('NFC').toLowerCase();
    if (!person.image || seen.has(key)) return [];
    seen.add(key);
    return [{ filename, url: person.image }];
  }).slice(0, 60);
  const result = { downloaded: [] as string[], failed: [] as string[] };
  if (!portraits.length) return result;
  const root = await realpath(folder);
  const directory = join(root, '.actors');
  await mkdir(directory, { recursive: true });
  if (!isWithin(root, await realpath(directory))) throw new Error('Actor directory outside item folder');
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, portraits.length) }, async () => {
    while (next < portraits.length) {
      const portrait = portraits[next++]!;
      const path = join(directory, portrait.filename);
      try {
        await download(portrait.url, path);
        result.downloaded.push(path);
      } catch {
        result.failed.push(path);
      }
    }
  }));
  return result;
}
