import type Database from 'better-sqlite3';
import type { AutoBulkRequest, BindRequest, MatchSearchQuery, SetSecondaryRequest, SetSourceRequest } from 'shared';
import type { Env } from '../../config/env.js';
import { credential, type Settings } from '../../config/settings.js';
import { openDatabase } from '../../db/connection.js';
import { ProviderHttp } from '../providers/http.js';
import { TmdbClient } from '../providers/tmdb.js';
import { TvdbClient } from '../providers/tvdb.js';
import { Matcher } from './matcher.js';
import { overrideRequest, type OverrideInput } from '../nfo/overrides.js';
import { ArtworkService, type ArtworkInput } from '../artwork/artwork.js';
import { Providers } from '../providers/providers.js';
import { FanartClient } from '../providers/fanart.js';
import { dangerRequest,type DangerInput } from '../cleaner/danger.js';

export interface MatchInput { env: Env; settings: Settings; action: 'bind'|'source'|'secondary'|'unbind'|'bulk'|'search'|'overrides-get'|'overrides-set'|'overrides-clear'|'artwork'|'danger'; payload: unknown }
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
    case 'danger': return dangerRequest(db,input.env.media_root,input.payload as DangerInput);
    case 'artwork': return new ArtworkService(db,input.env.media_root,input.env.config_dir,input.settings,new Providers(providers.tvdb,providers.tmdb),new FanartClient(new ProviderHttp(db,keys.ttl),credential(input.settings,input.env,'fanart_api_key')??'')).request(input.payload as ArtworkInput);
    case 'overrides-get': return overrideRequest(db,input.env.media_root,'get',input.payload as OverrideInput);
    case 'overrides-set': return overrideRequest(db,input.env.media_root,'set',input.payload as OverrideInput);
    case 'overrides-clear': return overrideRequest(db,input.env.media_root,'clear',input.payload as OverrideInput);
    case 'bind': return matcher.bind(input.payload as BindRequest);
    case 'source': return matcher.source(input.payload as SetSourceRequest);
    case 'secondary': return matcher.secondary(input.payload as SetSecondaryRequest);
    case 'unbind': return matcher.unbind(input.payload as string);
    case 'bulk': return matcher.bulk(input.payload as AutoBulkRequest);
    case 'search': return matcher.search(input.payload as MatchSearchQuery);
  }
}
