import { expect, test } from 'vitest';
import { settingsSchema } from '../../config/settings.js';
import { renderTemplate, sanitize } from './grammar.js';

test('renamer grammar resolves case-insensitive aliases, direct tokens and zero-padded integers', () => {
  const context = { title: 'The Office', season: 1, episode: 2, tvdb_id: 123, extra_field: 'custom', is_3d: true };
  expect(renderTemplate('{SERIES TITLE} S{Season Number:00}E{Episode:000} {TVDB ID} {Extra Field} {Missing}', context)).toBe('The Office S01E002 123 custom');
  expect(renderTemplate('{season:000}', { season: -1 })).toBe('-01');
  expect(renderTemplate('{season:00}', { season: 'Specials' })).toBe('Specials');
  expect(renderTemplate('{MediaInfo 3D}', context)).toBe('3D');
  expect(renderTemplate('{MediaInfo 3D}', { is_3d: false })).toBe('');
});

test('renamer grammar renders conditional groups, multi-token separators, suffixes and prefixes', () => {
  expect(renderTemplate('{[Quality Full]} {[Mediainfo AudioCodec}{ Mediainfo AudioChannels]} [{MediaInfo VideoBitDepth}bit]{-Release Group}', { quality_full: 'Bluray-1080p', audio_codec: 'DTS-HD MA', audio_channels: '5.1', video_bit_depth: 10, release_group: 'Group' })).toBe('[Bluray-1080p] [DTS-HD MA 5.1] [10bit]-Group');
  expect(renderTemplate('Show {[Missing]} [{MediaInfo VideoBitDepth}bit]{-Release Group} -{Missing}.mkv', {})).toBe('Show.mkv');
  expect(renderTemplate('{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}', { audio_channels: '2.0' })).toBe('[2.0]');
  expect(renderTemplate('Literal [text] {unfinished', {})).toBe('Literal [text] {unfinished');
});

test('renamer grammar renders nested groups only when an inner token has a value', () => {
  expect(renderTemplate('{Series Title} {tvdb-{TvdbId}}', { title: 'Show', tvdb_id: 42 })).toBe('Show tvdb-42');
  expect(renderTemplate('{Series Title} {tvdb-{TvdbId}}', { title: 'Show' })).toBe('Show');
  expect(renderTemplate('{outer-{inner-{TvdbId}}}', { tvdb_id: 42 })).toBe('outer-inner-42');
});

test('renamer grammar moves leading articles for Series TitleThe without dropping the title', () => {
  for (const [title, expected] of [['The Office', 'Office, The'], ['A Discovery', 'Discovery, A'], ['An Adventure', 'Adventure, An'], ['Office', 'Office']]) {
    expect(renderTemplate('{Series TitleThe}', { title })).toBe(expected);
  }
  expect(renderTemplate('{SERIES TITLETHE}', { title: 'The Office', series_title_the: 'Manual' })).toBe('Manual');
});

test('renamer grammar renders all default templates using the reference context keys', () => {
  const settings = settingsSchema.parse({});
  const context = { title: 'Show', series_titleyear: 'Show (2020)', series_cleantitle: 'Show', movie_cleantitle: 'Movie', year: 2020, year_parens: '(2020)', episode_cleantitle: 'Pilot', episode_title: 'Pilot', season: 1, episode: 2, air_date: '2020-01-02', tvdb_id: '42', tmdb_id: '43', edition_tags: 'Extended' };
  expect(renderTemplate(settings.rename_episode_template, context)).toBe('Show (2020) - S01E02 - Pilot');
  expect(renderTemplate(settings.rename_daily_template, context)).toBe('Show (2020) - 2020-01-02 - Pilot');
  expect(renderTemplate(settings.rename_anime_template, context)).toBe('Show (2020) - S01E02 - Pilot');
  expect(renderTemplate(settings.rename_series_folder_template, context)).toBe('Show (2020) tvdb-42');
  expect(renderTemplate(settings.rename_season_folder_template, context)).toBe('Season 01');
  expect(renderTemplate(settings.rename_movie_template, context)).toBe('Movie (2020) tmdb-43 edition-Extended');
  expect(renderTemplate(settings.rename_movie_folder_template, context)).toBe('Movie (2020) tmdb-43');
});

test('renamer sanitization removes Windows/SMB-invalid characters and trailing dots/spaces', () => {
  expect(sanitize('  A<>:"/\\|?*\u0000\u001f B...  ')).toBe('A B');
  expect(sanitize('日本語   Show')).toBe('日本語 Show');
  expect(sanitize('...')).toBe('');
});
