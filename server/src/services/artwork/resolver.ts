import type { MetadataSource } from 'shared';
import type { Settings } from '../../config/settings.js';
import type { Artwork } from '../providers/normalized.js';
import type { Sidecar } from '../sidecar/format.js';

function language(value: string | null) {
  const code = value?.trim().toLowerCase() ?? '';
  if (!code) return '';
  try { return new Intl.Locale(code).language; } catch { return code; }
}

export function resolveArtwork(art: Artwork[], settings: Settings, bound: MetadataSource, selections: Sidecar['artwork_selections'] = []): { candidates: Record<string, Artwork[]>; urls: Record<string, string> } {
  const candidates: Record<string, Artwork[]> = {}, urls: Record<string, string> = {};
  const languages = [...new Set([settings.preferred_language, ...settings.fallback_languages].map(language))];
  const languageRank = (artwork: Artwork) => {
    const code = language(artwork.language), index = languages.indexOf(code);
    return index >= 0 ? index : languages.length + (code ? 1 : 0);
  };
  const providerRank = (provider: Artwork['provider']) => provider === settings.preferred_artwork_source ? 0 : provider === bound ? 1 : 2;
  for (const artwork of art) {
    if (!artwork.url) continue;
    const slot = artwork.slot === 'poster' && artwork.season !== null ? `season-${String(artwork.season).padStart(2, '0')}-poster` : artwork.season === null ? artwork.slot : '';
    if (!/^(poster|background|banner|clearlogo|season-\d{2}-poster|episode-thumb-[A-Za-z0-9_-]+)$/.test(slot)) continue;
    (candidates[slot] ??= []).push(artwork);
  }
  for (const [slot, all] of Object.entries(candidates)) {
    candidates[slot] = (['tvdb', 'tmdb', 'fanart'] as const).flatMap(provider => {
      const available = all.filter(a => a.provider === provider);
      if (provider === 'fanart') return available;
      const whitelist = settings[`${provider}_artwork_languages`].map(language);
      const kept = available.filter(a => {
        const code = language(a.language);
        return code ? !whitelist.length || whitelist.includes(code) : settings[`${provider}_artwork_allow_null_language`];
      });
      return kept.length ? kept : available;
    }).sort((a, b) => providerRank(a.provider) - providerRank(b.provider) || languageRank(a) - languageRank(b) || b.score - a.score);
    // Season posters are selected only by the user, even when candidates exist.
    if (!slot.startsWith('season-') && candidates[slot]![0]) urls[slot] = candidates[slot]![0]!.url;
  }
  for (const selection of selections) urls[selection.slot] = selection.url;
  return { candidates, urls };
}
