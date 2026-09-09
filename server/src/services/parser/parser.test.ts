import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parseEpisode, parseFolder, parseMovie, isMovieFolder, seasonNumber } from './parser.js';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { writeTree } from '../../../tests/support/media-tree.js';

test('parser precedence, multi-episode, anime versions, daily dates and unparsed videos', () => {
  expect(parseEpisode('[Group] Show - 09 S02E03E04.mkv')).toMatchObject({ season: 2, episode: 3, end_episode: 4 });
  expect(parseEpisode('[Group] Show - 01v2 [WEB-DL].mkv')).toMatchObject({ season: 1, episode: 1 });
  expect(parseEpisode('[Group] Show - 01 [2024-02-29].mkv')).toMatchObject({ season: 1, episode: 1, air_date: null });
  expect(parseEpisode('Show - 2024-02-29 - Title [1080p]-GROUP.mkv')).toMatchObject({ air_date: '2024-02-29', raw_title: 'Title' });
  for (const name of ['Show - 2023-02-29.mkv', '[Group] Show - 2024.mkv', '[Group] Show - 01oops.mkv', 'Movie - 1.mp4', 'Unknown.avi']) expect(parseEpisode(name)?.parsed).toBe(false);
  expect(parseEpisode('subtitle.S01E01.srt')).toBeNull();
});
test('parser folder and movie IDs, season names, movie heuristic', async () => withSandbox(async box => {
  expect(parseFolder('Show (2020) {tvdb-123}')).toEqual({ title: 'Show', year: 2020, provider: 'tvdb', external_id: '123' });
  expect(parseMovie('Film (2022) {tmdb-123} {edition-Extended} [1080p]-GROUP.mkv')).toMatchObject({ title: 'Film', year: 2022, provider: 'tmdb', external_id: '123' });
  expect(seasonNumber('Specials')).toBe(0); expect(seasonNumber('Season 02')).toBe(2);
  await writeTree(box.media, { 'Movie/Film.mkv': '', 'Anime/[Group] Show - 01.mkv': '', 'Daily/Show 2024-02-29.mp4': '', 'Season/Season 01/unparsed.mkv': '' });
  expect(await isMovieFolder(join(box.media, 'Movie'))).toBe(true);
  for (const name of ['Anime', 'Daily', 'Season']) expect(await isMovieFolder(join(box.media, name))).toBe(false);
}));
