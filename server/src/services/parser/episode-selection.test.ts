import { expect, test } from 'vitest';
import type { Episode } from '../providers/normalized.js';
import { selectEpisode } from './episode-selection.js';

const episodes: Episode[] = [
  { id: 'one', season: 1, episode: 1, title: 'One', plot: '', aired: '2020-01-01', runtime: null, image: null },
  { id: 'two', season: 1, episode: 2, title: 'Two', plot: '', aired: '2020-01-02', runtime: null, image: null },
  { id: 'special', season: 0, episode: 1, title: 'Special', plot: '', aired: null, runtime: null, image: null },
];

test('episode selection builds unparsed files only with a complete saved mapping', () => {
  expect(selectEpisode('unknown.mkv', 'Season 01/unknown.mkv', episodes)).toBeUndefined();
  expect(selectEpisode('unknown.mkv', 'Season 01/unknown.mkv', episodes, [
    { file_path: 'Season 01/unknown.mkv', season: 1, episode: 2, external_id: null },
  ])).toBe(episodes[1]);
  expect(selectEpisode('unknown.mkv', 'unknown.mkv', episodes, [
    { file_path: 'unknown.mkv', season: 1, episode: null, external_id: null },
  ])).toBeUndefined();
});

test('episode selection combines per-file numeric overrides with parsed coordinates', () => {
  expect(selectEpisode('Show.S01E01.mkv', 'Show.S01E01.mkv', episodes, [
    { file_path: 'Show.S01E01.mkv', season: null, episode: 2, external_id: null },
  ])).toBe(episodes[1]);
  expect(selectEpisode('Show.S01E01.mkv', 'Show.S01E01.mkv', episodes, [
    { file_path: 'Show.S01E01.mkv', season: 0, episode: null, external_id: null },
  ])).toBe(episodes[2]);
});

test('episode selection honors explicit file IDs before numeric mappings and never silently falls back', () => {
  const mapping = { file_path: 'Show.S01E01.mkv', season: 1, episode: 1, external_id: 'two' };
  expect(selectEpisode(mapping.file_path, mapping.file_path, episodes, [mapping])).toBe(episodes[1]);
  expect(selectEpisode(mapping.file_path, mapping.file_path, episodes, [{ ...mapping, external_id: 'missing' }])).toBeUndefined();
  expect(selectEpisode('unknown.mkv', 'unknown.mkv', episodes, [{ ...mapping, file_path: 'unknown.mkv', season: null, episode: null }])).toBe(episodes[1]);
});

test('episode selection applies legacy mappings, daily dates and ordinary parsed coordinates', () => {
  expect(selectEpisode('Show.S01E01.mkv', 'Show.S01E01.mkv', episodes)).toBe(episodes[0]);
  expect(selectEpisode('Show.S01E01.mkv', 'Show.S01E01.mkv', episodes, [], [{ season: 1, episode: 1, tvdb_episode_id: 'two' }])).toBe(episodes[1]);
  expect(selectEpisode('Show.S01E01.mkv', 'Show.S01E01.mkv', episodes, [], [{ season: 1, episode: 1, tvdb_episode_id: 'missing' }])).toBeUndefined();
  expect(selectEpisode('Show.2020-01-02.mkv', 'Show.2020-01-02.mkv', episodes)).toBe(episodes[1]);
  expect(selectEpisode('Show.2020-01-02.mkv', 'Show.2020-01-02.mkv', episodes, [{ file_path: 'Show.2020-01-02.mkv', season: 0, episode: 1, external_id: null }])).toBe(episodes[2]);
});
