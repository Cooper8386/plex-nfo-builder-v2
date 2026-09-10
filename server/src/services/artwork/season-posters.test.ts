import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { openDatabase } from '../../db/connection.js';
import { folderSnapshot, restoreSnapshot } from '../../db/queries.js';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { sidecarSchema, type Sidecar } from '../sidecar/format.js';
import { recoverSidecar, writeSidecar } from '../sidecar/sidecar.js';
import { seasonPosterProgress, seasonSlot, selectSeasonPosters } from './season-posters.js';

function choice(season: number): Sidecar['artwork_selections'][number] {
  return { slot: seasonSlot(season), url: `https://example.com/manual-psych-${season}.jpg`, language: 'eng', score: -season };
}

async function video(folder: string, path: string) {
  const target = join(folder, path);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, 'video');
}

test('season-posters preserve all eight manual Psych choices without ranking or guessing alternatives', async () => withSandbox(async box => {
  const seasons = Array.from({ length: 8 }, (_, index) => index + 1);
  const selections = seasons.map(choice);
  for (const season of seasons) await video(box.media, `Season ${String(season).padStart(2, '0')}/Psych.S${String(season).padStart(2, '0')}E01.mkv`);
  expect(selectSeasonPosters([...selections, { slot: 'poster', url: 'https://example.com/top-ranked.jpg', score: 100, language: null }]))
    .toEqual(Object.fromEntries(selections.map(selection => [selection.slot, selection.url])));
  expect((await seasonPosterProgress(box.media, [])).state).toBe('not_started');
  expect(await seasonPosterProgress(box.media, selections.slice(0, 2))).toMatchObject({ state: 'in_progress', selected_seasons: [1, 2], missing_seasons: [3, 4, 5, 6, 7, 8] });
  expect(await seasonPosterProgress(box.media, selections)).toEqual({ state: 'selected', required_seasons: seasons, selected_seasons: seasons, missing_seasons: [], unresolved_files: [] });
  await video(box.media, 'Season 09/Psych.S09E01.mkv');
  expect(await seasonPosterProgress(box.media, selections)).toMatchObject({ state: 'in_progress', missing_seasons: [9] });
  expect((await seasonPosterProgress(box.media, [])).state).toBe('not_started');
}));

test('season-posters count specials and root videos, prefer file overrides, and leave unknown mappings unresolved', async () => withSandbox(async box => {
  await video(box.media, 'Specials/Special.mkv');
  await video(box.media, 'Series.S02E01.mkv');
  await video(box.media, 'Season 03/Series.S09E01.mkv');
  await video(box.media, 'Daily.2026-09-09.mkv');
  await video(box.media, 'Unknown.mkv');
  await mkdir(join(box.media, 'Season 08'));
  const selections = [choice(0), choice(2), choice(4), choice(5)];
  const overrides = [{ file_path: 'Season 03/Series.S09E01.mkv', season: 4, episode: 1, external_id: null }];
  expect(await seasonPosterProgress(box.media, selections, overrides)).toEqual({
    state: 'in_progress', required_seasons: [0, 2, 4], selected_seasons: [0, 2, 4], missing_seasons: [],
    unresolved_files: ['Daily.2026-09-09.mkv', 'Unknown.mkv'],
  });
  expect((await seasonPosterProgress(box.media, [], overrides)).state).toBe('not_started');
  expect(await seasonPosterProgress(box.media, selections, [
    ...overrides,
    { file_path: 'Daily.2026-09-09.mkv', season: 5, episode: null, external_id: null },
    { file_path: 'Unknown.mkv', season: 0, episode: 2, external_id: null },
  ])).toMatchObject({ state: 'selected', required_seasons: [0, 2, 4, 5], unresolved_files: [] });
  expect((await seasonPosterProgress(box.media, [], [])).required_seasons).toEqual([0, 2, 3]);
}));

test('season-posters are not applicable without local videos, even with empty season directories or saved choices', async () => withSandbox(async box => {
  await mkdir(join(box.media, 'Season 01'));
  await writeFile(join(box.media, 'Season 01', 'season.nfo'), 'metadata');
  expect(await seasonPosterProgress(box.media, [choice(1)])).toEqual({ state: 'not_applicable', required_seasons: [], selected_seasons: [], missing_seasons: [], unresolved_files: [] });
  await video(box.media, 'Unknown.mkv');
  expect((await seasonPosterProgress(box.media, [choice(1)])).state).toBe('in_progress');
  expect((await seasonPosterProgress(box.media, [])).state).toBe('not_started');
}));

test('season-posters recover manual choices from a sidecar after database loss', async () => withSandbox(async box => {
  const selections = Array.from({ length: 8 }, (_, index) => choice(index + 1));
  const snapshot = sidecarSchema.parse({ version: 2, binding: { kind: 'series', provider: 'tvdb', external_id: '79335', title: 'Psych' }, artwork_selections: selections });
  const original = await openDatabase(box.config);
  try {
    restoreSnapshot(original, box.media, snapshot);
    await writeSidecar(box.media, folderSnapshot(original, box.media));
  } finally { original.close(); }
  const recovered = await openDatabase(join(box.config, 'fresh'));
  try {
    expect(await recoverSidecar(recovered, box.media)).toBe(true);
    expect(selectSeasonPosters(folderSnapshot(recovered, box.media).artwork_selections)).toEqual(selectSeasonPosters(selections));
  } finally { recovered.close(); }
}));
