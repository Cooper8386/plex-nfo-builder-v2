import { expect, test } from 'vitest';
import { settingsSchema } from '../../config/settings.js';
import type { Artwork } from '../providers/normalized.js';
import { resolveArtwork } from './resolver.js';

const art = (provider: Artwork['provider'], language: string | null, score: number, slot = 'poster', season: number | null = null): Artwork => ({
  provider, language, score, slot, season, id: `${provider}-${language}-${score}`, url: `https://example.com/${provider}/${language}/${score}.jpg`,
  thumb: null, width: null, height: null,
});

test('artwork resolver prefers configured TMDB source over TVDB binding and then language and score', () => {
  const candidates = [art('tvdb', 'eng', 100), art('tmdb', 'ja', 99), art('tmdb', 'en', 1), art('tmdb', 'en', 2)];
  const settings = settingsSchema.parse({ preferred_artwork_source: 'tmdb' });
  expect(resolveArtwork(candidates, settings, 'tvdb').urls.poster).toBe(candidates[3]!.url);
  expect(resolveArtwork(candidates, settingsSchema.parse({}), 'tvdb').urls.poster).toBe(candidates[0]!.url);
  expect(resolveArtwork(candidates.slice(1, 2), settings, 'tvdb').urls.poster).toBe(candidates[1]!.url);
});

test('artwork resolver treats empty whitelists as no language filter and honors null toggle', () => {
  const candidates = [art('tmdb', 'ja', 3), art('tmdb', 'en', 1), art('tmdb', null, 2)];
  const settings = settingsSchema.parse({ tmdb_artwork_languages: [] });
  expect(resolveArtwork(candidates, settings, 'tmdb').candidates.poster).toHaveLength(3);
  expect(resolveArtwork(candidates, { ...settings, tmdb_artwork_allow_null_language: false }, 'tmdb').candidates.poster).toHaveLength(2);
});

test('artwork resolver canonicalizes language codes and falls back unfiltered per provider and slot', () => {
  const candidates = [art('tmdb', 'en', 1), art('tmdb', 'ja', 2), art('tvdb', 'jpn', 3), art('tmdb', 'ja', 4, 'background')];
  const settings = settingsSchema.parse({ tmdb_artwork_languages: ['eng'], tvdb_artwork_languages: ['fra'], tmdb_artwork_allow_null_language: false });
  const result = resolveArtwork(candidates, settings, 'tmdb');
  expect(result.candidates.poster?.map(a => a.url)).toEqual([candidates[0]!.url, candidates[2]!.url]);
  expect(result.urls.background).toBe(candidates[3]!.url);
  const fallback = resolveArtwork([art('tmdb', 'de', 50), art('tmdb', 'fr', 1)], settingsSchema.parse({ preferred_language: 'jpn', fallback_languages: ['fra'] }), 'tmdb');
  expect(fallback.candidates.poster?.[0]?.language).toBe('fr');
});

test('artwork resolver keeps season posters manual and saved selections override filters and preference', () => {
  const candidates = [art('tvdb', 'ja', 1), art('tmdb', 'en', 2), art('tvdb', 'ja', 3, 'poster', 1), art('tmdb', 'en', 4, 'poster', 2), art('tvdb', 'eng', 5)];
  const settings = settingsSchema.parse({ preferred_artwork_source: 'tmdb', tvdb_artwork_languages: ['eng'] });
  const automatic = resolveArtwork(candidates, settings, 'tvdb');
  expect(automatic.urls).toEqual({ poster: candidates[1]!.url });
  expect(automatic.candidates.poster?.some(a => a.url === candidates[0]!.url)).toBe(false);
  expect(automatic.candidates['season-01-poster']).toHaveLength(1);
  expect(automatic.candidates['season-02-poster']).toHaveLength(1);
  const saved = resolveArtwork(candidates, settings, 'tvdb', [
    { slot: 'poster', url: candidates[0]!.url, language: 'ja', score: 1 },
    { slot: 'season-01-poster', url: 'https://example.com/custom.jpg', language: null, score: null },
    { slot: 'episode-thumb-7', url: 'https://example.com/episode.jpg', language: null, score: null },
  ]);
  expect(saved.urls.poster).toBe(candidates[0]!.url);
  expect(saved.urls['season-01-poster']).toBe('https://example.com/custom.jpg');
  expect(saved.urls['episode-thumb-7']).toBe('https://example.com/episode.jpg');
  expect(saved.urls['season-02-poster']).toBeUndefined();
});
