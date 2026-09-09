import type Database from 'better-sqlite3';
import type { AutoBulkRequest, BindRequest, MatchSearchQuery, SetSecondaryRequest, SetSourceRequest } from 'shared';
import type { Env } from '../../config/env.js';
import { credential, type Settings } from '../../config/settings.js';
import { openDatabase } from '../../db/connection.js';
import { ProviderHttp } from '../providers/http.js';
import { TmdbClient } from '../providers/tmdb.js';
import { TvdbClient } from '../providers/tvdb.js';
import { Matcher } from './matcher.js';

export interface MatchInput { env: Env; settings: Settings; action: 'bind'|'source'|'secondary'|'unbind'|'bulk'|'search'; payload: unknown }
let db: Database.Database | undefined, config: string | undefined, signature = '', providers: { tvdb:TvdbClient; tmdb:TmdbClient } | undefined;
export async function handle(input: MatchInput) {
  if (!db) { db = await openDatabase(input.env.config_dir); config = input.env.config_dir; }
  if (config !== input.env.config_dir) throw new Error('Matcher worker owns one config directory');
  const keys = { tvdb:credential(input.settings,input.env,'tvdb_api_key') ?? '', pin:credential(input.settings,input.env,'tvdb_pin') ?? '', tmdb:credential(input.settings,input.env,'tmdb_api_key') ?? '', ttl:input.settings.cache_ttl_hours * 3600 };
  if (!providers || signature !== JSON.stringify(keys)) {
    const http = new ProviderHttp(db,keys.ttl);
    providers = { tvdb:new TvdbClient(http,keys.tvdb,keys.pin), tmdb:new TmdbClient(http,keys.tmdb) }; signature = JSON.stringify(keys);
  }
  const matcher = new Matcher(db,input.env.media_root,input.settings,providers);
  switch (input.action) {
    case 'bind': return matcher.bind(input.payload as BindRequest);
    case 'source': return matcher.source(input.payload as SetSourceRequest);
    case 'secondary': return matcher.secondary(input.payload as SetSecondaryRequest);
    case 'unbind': return matcher.unbind(input.payload as string);
    case 'bulk': return matcher.bulk(input.payload as AutoBulkRequest);
    case 'search': return matcher.search(input.payload as MatchSearchQuery);
  }
}
