import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { configPaths, isWithin, mediaPath } from './paths.js';
import { withSandbox } from '../../tests/support/sandbox.js';

test('paths reject sibling-prefix escapes and resolve symbolic links before containment checks', async () => withSandbox(async box => {
  const folder = join(box.media, 'Show');
  const sibling = join(box.media, 'Show 2');
  await Promise.all([mkdir(folder), mkdir(sibling)]);
  expect(isWithin(folder, sibling)).toBe(false);
  expect(isWithin(folder, join(folder, 'Season 01'))).toBe(true);
  expect(await mediaPath(box.media, 'Show')).toBe(folder);
  await symlink(box.config, join(box.media, 'outside'), 'junction');
  await expect(mediaPath(box.media, 'outside')).rejects.toThrow('Path outside MEDIA_ROOT');
  expect(configPaths(box.config).database).toBe(join(box.config, 'app.db'));
}));
