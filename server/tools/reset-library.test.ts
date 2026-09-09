import { access, chmod, mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { mediaTree, withSandbox, writeTree } from '../tests/support/index.js';
import { applyReset, previewReset } from './reset-library.js';

test.each(['season-tv', 'root-tv', 'movie', 'foreign'] as const)('reset-library dry-run and confirm preserve media in %s layout', async layout => withSandbox(async box => {
  const media = await mediaTree(box.media, layout);
  const preserved = media.filter(path => !path.endsWith('.nfo'));
  await writeTree(box.media, {
    'generated/Poster.JPG': 'art', 'generated/Season00-poster.jpg': 'art', 'generated/season-specials-poster.jpg': 'art',
    'generated/BACKGROUND.png': 'art', 'generated/banner.jpg': 'art', 'generated/clearlogo.png': 'art',
    'generated/old-thumb.jpeg': 'thumb', 'generated/foreign.nfo': '<movie/>', 'generated/.plex-nfo-builder.json': '{}',
    'generated/.actors/Actor.jpg': 'portrait',
    'generated/logo.png': 'unattributed', 'generated/sub.en.forced.srt': 'subtitle', 'generated/audio.flac': 'audio',
    'generated/episode-thumb.mkv': 'video', 'generated/episode-thumb.srt': 'subtitle',
  });
  await mkdir(join(box.media, 'generated', 'Season 01'));
  for (const path of ['logo.png', 'sub.en.forced.srt', 'audio.flac', 'episode-thumb.mkv', 'episode-thumb.srt', 'Season 01']) preserved.push(join(box.media, 'generated', path));
  const plan = await previewReset(box.media);
  expect(plan.files.length).toBeGreaterThan(10);
  for (const item of plan.files) await access(item.path);
  await expect(applyReset(plan)).rejects.toThrow('explicit confirmation');
  const result = await applyReset(plan, true);
  expect(result.skipped).toEqual([]);
  expect(result.removed).toEqual(plan.files.map(file => file.path));
  for (const path of preserved) await access(path);
  for (const item of plan.files) await expect(access(item.path)).rejects.toMatchObject({ code: 'ENOENT' });
}));

test('reset-library does not delete new, changed, unknown, or linked files', async () => withSandbox(async box => {
  await writeTree(box.media, { 'show/poster.jpg': 'old', 'show/old.nfo': 'old', 'show/.actors/Actor.jpg': 'portrait', 'show/.actors/media.mkv': 'video' });
  await writeTree(box.config, { 'outside.nfo': 'keep' });
  await symlink(box.config, join(box.media, 'linked'), 'junction');
  const plan = await previewReset(box.media);
  await writeTree(box.media, { 'show/poster.jpg': 'changed contents', 'show/new.nfo': 'new' });
  const result = await applyReset(plan, true);
  expect(result.skipped.some(file => file.path.endsWith('poster.jpg'))).toBe(true);
  for (const path of ['show/poster.jpg', 'show/new.nfo', 'show/.actors/media.mkv']) await access(join(box.media, path));
  expect(await readFile(join(box.config, 'outside.nfo'), 'utf8')).toBe('keep');
}));

test('reset-library refuses a directory swapped for a junction after preview', async () => withSandbox(async box => {
  await writeTree(box.media, { 'show/episode.nfo': 'ours' });
  await writeTree(box.config, { 'episode.nfo': 'outside' });
  const plan = await previewReset(box.media);
  await rename(join(box.media, 'show'), join(box.media, 'original'));
  await symlink(box.config, join(box.media, 'show'), 'junction');
  expect((await applyReset(plan, true)).removed).toEqual([]);
  expect(await readFile(join(box.config, 'episode.nfo'), 'utf8')).toBe('outside');
}));

test('reset-library CLI defaults to dry-run and exits zero without changing fixture tree', async () => withSandbox(async box => {
  await mediaTree(box.media, 'foreign');
  const before = await readdir(box.media, { recursive: true });
  const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./reset-library.ts', import.meta.url)), '--media-root', box.media]);
  expect(result.stdout).toContain('Dry-run only. No files deleted.');
  expect(await readdir(box.media, { recursive: true })).toEqual(before);
  expect(await readFile(join(box.media, 'Foreign/tvshow.nfo'), 'utf8')).toContain('<tvshow>');
}));

test('reset-library keeps a new file inside an actor directory after preview', async () => withSandbox(async box => {
  await writeTree(box.media, { '.actors/Actor.jpg': 'portrait' });
  const plan = await previewReset(box.media);
  await writeFile(join(box.media, '.actors/new.jpg'), 'new');
  const result = await applyReset(plan, true);
  expect(result.skipped).toHaveLength(1);
  expect(await readFile(join(box.media, '.actors/new.jpg'), 'utf8')).toBe('new');
}));

test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('reset-library reports and skips unreadable directories', async () => withSandbox(async box => {
  const folder = join(box.media, 'unreadable');
  await writeTree(box.media, { 'unreadable/foreign.nfo': 'keep' });
  await chmod(folder, 0);
  try {
    const plan = await previewReset(box.media);
    expect(plan.files).toEqual([]);
    expect(plan.skipped).toEqual([{ path: folder, reason: 'Unreadable directory' }]);
    expect((await applyReset(plan, true)).removed).toEqual([]);
  } finally { await chmod(folder, 0o700); }
  expect(await readFile(join(folder, 'foreign.nfo'), 'utf8')).toBe('keep');
}));
