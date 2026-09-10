import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import type { Cast } from '../providers/normalized.js';
import { actorFilename, downloadActors } from './actors.js';

function actor(name: string, order = 0, image: string | null = 'https://example.com/portrait.jpg'): Cast {
  return { id: String(order), name, character: 'Role', character_type: 'Actor', order, image };
}

test('actors sanitize unsafe characters while preserving spaces and unicode', () => {
  expect(actorFilename('Zoë 李')).toBe('Zoë 李.jpg');
  expect(actorFilename('<>:"|?*/\\\u0000\u001f\u007f')).toBe('____________.jpg');
  expect(actorFilename('')).toBe('unknown.jpg');
});

test('actors cap portraits at 60 and downloads at eight concurrent requests', async () => withSandbox(async box => {
  let active = 0;
  let peak = 0;
  const result = await downloadActors(box.media, Array.from({ length: 70 }, (_, i) => actor(`Person ${i}`, i)), async (_url, path) => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 5));
    await writeFile(path, 'portrait');
    active--;
  });
  expect(peak).toBe(8);
  expect(result.downloaded).toHaveLength(60);
  expect(result.failed).toEqual([]);
  expect(await readdir(join(box.media, '.actors'))).toHaveLength(60);
}));

test('actors reuse cast filtering, skip absent images and filename collisions, and isolate failures', async () => withSandbox(async box => {
  const cast = [
    { ...actor('Director', 0), character_type: 'Director' },
    actor('No Image', 1, null), actor('Name/One', 2), actor('name\\one', 3),
    actor('Failed', 4), actor('Success', 5),
  ];
  const result = await downloadActors(box.media, cast, async (_url, path) => {
    if (path.endsWith('Failed.jpg')) throw new Error('Provider unavailable');
    await writeFile(path, 'portrait');
  });
  expect(result.downloaded.sort()).toEqual([join(box.media, '.actors', 'Name_One.jpg'), join(box.media, '.actors', 'Success.jpg')].sort());
  expect(result.failed).toEqual([join(box.media, '.actors', 'Failed.jpg')]);
}));

test('actors refuse an existing directory symlink that escapes the item', async () => withSandbox(async box => {
  const folder = join(box.media, 'Item');
  await mkdir(folder);
  await symlink(box.config, join(folder, '.actors'), 'junction');
  let calls = 0;
  await expect(downloadActors(folder, [actor('Person')], async () => { calls++; })).rejects.toThrow('Actor directory outside item folder');
  expect(calls).toBe(0);
  expect(await readdir(box.config)).toEqual([]);
}));
