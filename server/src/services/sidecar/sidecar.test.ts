import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { openDatabase } from '../../db/connection.js';
import { folderSnapshot, getBinding, restoreSnapshot } from '../../db/queries.js';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { readSidecar, recoverSidecar, sidecarName, writeSidecar } from './sidecar.js';
import { sidecarSchema } from './format.js';

const record = () => sidecarSchema.parse({
  version: 2,
  binding: { kind: 'series', provider: 'tvdb', external_id: '123', title: 'Show', source_locked: true, secondary_provider: 'tmdb', secondary_external_id: '456' },
  overrides: [{ scope: 'series', field: 'title', value: 'Custom title' }, { scope: 'season-01', field: 'plot', value: 'Season plot' }, { scope: 'episode-789', field: 'sorttitle', value: 'Episode' }],
  artwork_selections: [{ slot: 'poster', url: 'https://example.org/poster.jpg', language: 'eng', score: 5 }, { slot: 'episode-thumb-789', url: 'https://example.org/thumb.jpg' }],
  episode_overrides: [{ season: 1, episode: 2, tvdb_episode_id: '789' }],
  episode_file_overrides: [{ file_path: 'Season 01/Show.S01E02.mkv', season: 1, episode: 2, external_id: '789' }],
  custom_tags: ['Anime', 'anime', 'Favorite'],
});

test('sidecar survives a full database wipe and restores all state under a moved folder', async () => withSandbox(async box => {
  let db = await openDatabase(box.config);
  const folder = join(box.media, 'Show');
  const moved = join(box.media, 'Moved Show');
  await mkdir(folder);
  try {
    restoreSnapshot(db, folder, record());
    const snapshot = folderSnapshot(db, folder);
    await writeSidecar(folder, snapshot);
    db.close();
    // A fresh config directory represents an entirely wiped database, including every table.
    db = await openDatabase(join(box.config, 'fresh'));
    await rename(folder, moved);
    expect(await recoverSidecar(db, moved)).toBe(true);
    expect(folderSnapshot(db, moved)).toEqual(snapshot);
    expect(await recoverSidecar(db, moved)).toBe(false);
    await writeSidecar(moved, { ...snapshot, binding: { ...snapshot.binding!, title: 'Stale sidecar title' } });
    expect(await recoverSidecar(db, moved)).toBe(false);
    expect(getBinding(db, moved)?.title).toBe('Show');
  } finally { db.close(); }
}));

test('sidecar handles missing, truncated, legacy, and invalid files without restoring partial state', async () => withSandbox(async box => {
  expect(await readSidecar(box.media)).toBeNull();
  await writeSidecar(box.media, record());
  const text = await readFile(join(box.media, sidecarName), 'utf8');
  await writeFile(join(box.media, sidecarName), text.slice(0, 45));
  expect(await readSidecar(box.media)).toBeNull();
  for (const contents of ['{"version":1}', '{"version":2,"binding":false}']) {
    await writeFile(join(box.media, sidecarName), contents);
    expect(await readSidecar(box.media)).toBeNull();
  }
  await writeSidecar(box.media, record());
  expect(await readdir(box.media)).toEqual([sidecarName]);
  expect(await readSidecar(box.media)).toEqual(record());
}));

test.each(['../outside.mkv', '/absolute.mkv', 'C:/outside.mkv', 'Season 01/../../outside.mkv', '..\\outside.mkv'])('sidecar rejects escaping relative path %s before writing or restoring', async file_path => withSandbox(async box => {
  const data = record();
  data.episode_file_overrides[0]!.file_path = file_path;
  await expect(writeSidecar(box.media, data)).rejects.toThrow('relative media file path');
  expect(await readdir(box.media)).toEqual([]);
}));

test('sidecar database restoration rolls back the whole folder on conflicting keys', async () => withSandbox(async box => {
  const db = await openDatabase(box.config);
  try {
    restoreSnapshot(db, box.media, record());
    const before = folderSnapshot(db, box.media);
    const invalid = record();
    invalid.overrides.push(invalid.overrides[0]!);
    expect(() => restoreSnapshot(db, box.media, invalid)).toThrow();
    expect(folderSnapshot(db, box.media)).toEqual(before);
  } finally { db.close(); }
}));
