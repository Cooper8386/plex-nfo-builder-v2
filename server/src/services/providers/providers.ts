import type { ItemKind, MetadataSource } from 'shared';
import type { MetadataProvider } from './normalized.js';
import { TmdbClient } from './tmdb.js';
import { TvdbClient } from './tvdb.js';
export class Providers {
  constructor(readonly tvdb: TvdbClient, readonly tmdb: TmdbClient) {}
  client(source: MetadataSource): MetadataProvider { return this[source]; }
  async details(source: MetadataSource, kind: ItemKind, id: string, options: { force?: boolean; language?: string; secondaryTmdbId?: string } = {}) {
    const data = await this[source].details(kind, id, options);
    if (source === 'tvdb' && kind === 'movie') {
      let tmdbId = options.secondaryTmdbId ?? data.ids.tmdb;
      if (!tmdbId && data.ids.imdb) tmdbId = (await this.tmdb.findImdb(data.ids.imdb, kind))[0]?.id;
      if (tmdbId) { const movie = await this.tmdb.details(kind, tmdbId, options); data.cast = movie.cast; data.ids.tmdb = tmdbId; }
    }
    return data;
  }
}
