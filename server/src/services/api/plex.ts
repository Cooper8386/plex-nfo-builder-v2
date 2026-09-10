import { setTimeout as sleep } from 'node:timers/promises';
import type Database from 'better-sqlite3';
import type { Env } from '../../config/env.js';
import type { Settings } from '../../config/settings.js';
import { mediaPath } from '../../config/paths.js';
import { apiUrl, ProviderHttp, type Transport } from '../providers/http.js';
import { PlexClient, translatePath } from '../providers/plex.js';
import { row, rows, str } from '../providers/normalized.js';

export type PlexInput = { op: 'test' } | { op: 'sections' } | { op: 'refresh'; path: string; delay_seconds?: number };
const unconfigured = 'Plex is not configured. Set plex_url and plex_token in Settings.';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function failure(statusCode: number, detail: string): never { throw Object.assign(new Error(detail), { statusCode }); }

export async function plexRequest(db: Database.Database, env: Env, settings: Settings, input: PlexInput, testing: { send?: Transport; wait?: (ms: number) => Promise<unknown> } = {}) {
  const http = new ProviderHttp(db, undefined, testing.send, testing.wait);
  const client = () => {
    if (!settings.plex_url || !settings.plex_token) throw new Error(unconfigured);
    new URL(settings.plex_url);
    return new PlexClient(http, settings.plex_url, settings.plex_token);
  };
  const sections = async (plex: PlexClient) => (await plex.sectionsOrThrow()).map(section => ({ ...section, key: section.id }));
  if (input.op === 'sections') {
    if (!settings.plex_url || !settings.plex_token) failure(400, 'Plex is not configured');
    let plex: PlexClient;
    try { plex = client(); } catch (error) { return failure(500, message(error)); }
    try { return { sections: await sections(plex) }; } catch (error) { return failure(502, message(error)); }
  }
  if (input.op === 'test') {
    try { const plex = client(); return { ok: true as const, identity: await plex.identityOrThrow(), sections: await sections(plex) }; }
    catch (error) { return { ok: false as const, error: message(error) }; }
  }
  if (!input.path.trim()) failure(400, 'path is required');
  // Validate local filesystem scope before making any external refresh request.
  const canonical = await mediaPath(env.media_root, input.path);
  const summary = {
    requested_local_path: input.path, translated_path: null as string | null,
    section_id: null as string | null, section_title: null as string | null,
    refreshed: false, error: null as string | null, rating_key: null as string | null,
    item_title: null as string | null, strategy: null as 'metadata-refresh' | 'partial-scan-only' | null,
    item_count: undefined as number | undefined,
  };
  try {
    const translated = translatePath(canonical, settings.plex_path_mappings);
    summary.translated_path = translated;
    const plex = client();
    const section = (await sections(plex)).flatMap(section => section.locations.map(location => ({ ...section, location: location.replace(/\/+$/, '') })))
      .filter(section => section.location && (translated === section.location || translated.startsWith(section.location + '/')))
      .sort((a, b) => b.location.length - a.location.length)[0];
    if (!section) {
      summary.error = `No Plex section contains '${translated}'. Check your path mappings in Settings.`;
      return summary;
    }
    summary.section_id = section.id; summary.section_title = section.title;
    const delay = Math.max(0, Math.min(600, Math.trunc(input.delay_seconds ?? 0)));
    if (delay > 0) await (testing.wait ?? sleep)(delay * 1000);
    const request = (path: string, query: Record<string, string> = {}, method = 'GET') => http.json(apiUrl(settings.plex_url!, path, query), {
      method, cache: false, headers: { 'X-Plex-Token': settings.plex_token!, Accept: 'application/json' },
    });
    try { await request(`/library/sections/${encodeURIComponent(section.id)}/refresh`, { path: translated }); }
    catch { /* Metadata refresh can succeed even when the partial scan fails. */ }
    const items = async (type: number) => {
      try {
        const container = row(row(await request(`/library/sections/${encodeURIComponent(section.id)}/all`, { type: String(type), includeCollections: '0', includeLocations: '1' })).MediaContainer);
        return (container.Metadata ? rows(container.Metadata) : [...rows(container.Directory), ...rows(container.Video)]).map(item => ({
          rating_key: str(item.ratingKey), title: str(item.title), locations: rows(item.Location).map(location => str(location.path)),
          files: rows(item.Media).flatMap(media => rows(media.Part).map(part => str(part.file))),
          grandparent_rating_key: str(item.grandparentRatingKey), grandparent_title: str(item.grandparentTitle),
        }));
      } catch { return []; }
    };
    const type = section.type === 'movie' ? 1 : section.type === 'show' ? 2 : null;
    const listing = type ? await items(type) : [];
    const target = translated.replace(/\/+$/, '');
    let matched: { rating_key: string; title: string } | undefined = listing.find(item =>
      item.locations.some(location => {
        const path = location.replace(/\/+$/, '');
        return path && (path === target || path.startsWith(target + '/') || target.startsWith(path + '/'));
      }) || item.files.some(file => file.startsWith(target + '/') || target.startsWith(file.slice(0, file.lastIndexOf('/')) + '/')));
    if (!matched && type === 2) {
      const parents = new Map<string, string>();
      for (const episode of await items(4)) if (episode.grandparent_rating_key && episode.files.some(file => file === target || file.startsWith(target + '/'))) {
        parents.set(episode.grandparent_rating_key, episode.grandparent_title);
      }
      if (parents.size === 1) { const [rating_key, title] = [...parents][0]!; matched = { rating_key, title }; }
    }
    if (matched?.rating_key) {
      summary.rating_key = matched.rating_key; summary.item_title = matched.title;
      await request(`/library/metadata/${encodeURIComponent(matched.rating_key)}/refresh`, {}, 'PUT');
      summary.strategy = 'metadata-refresh'; summary.refreshed = true;
    } else {
      summary.strategy = 'partial-scan-only'; summary.refreshed = true; summary.item_count = listing.length;
      summary.error = `Partial scan sent to section '${section.title}' but no item in that section claims folder '${translated}' (listed ${listing.length} items). If the show is clearly visible in Plex, this is usually a path-mapping mismatch — compare the path above to the Location shown by Test Connection in Settings.`;
    }
  } catch (error) { summary.error = message(error); }
  return summary;
}
