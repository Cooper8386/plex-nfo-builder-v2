import type Database from 'better-sqlite3';
import type { Env } from '../../config/env.js';
import { credential,type Settings } from '../../config/settings.js';
import { openDatabase } from '../../db/connection.js';
import { ProviderHttp } from '../providers/http.js';
import { Providers } from '../providers/providers.js';
import { TmdbClient } from '../providers/tmdb.js';
import { TvdbClient } from '../providers/tvdb.js';
import { browse,appLog,jobLog } from './files.js';
import { detail,episodes,thumbnails,mutateItem,deleteLibrary,type ItemMutation } from './items.js';
import { plexRequest,type PlexInput } from './plex.js';
export type ApiInput={op:'browse';path?:string}|{op:'detail'|'episodes';path:string}|{op:'thumbs';path:string;season:number;episode:number}|{op:'app-log';tail?:number}|{op:'job-log';id:string}|{op:'tvdb';kind:'series'|'movie';id:string}|{op:'cache-clear'}|{op:'library-delete';name:string}|{op:'mutate';input:ItemMutation}|{op:'plex';input:PlexInput};
export async function apiRequest(db:Database.Database,env:Env,settings:Settings,input:ApiInput){
  const http=new ProviderHttp(db,settings.cache_ttl_hours*3600),providers=new Providers(new TvdbClient(http,credential(settings,env,'tvdb_api_key')??'',credential(settings,env,'tvdb_pin')??''),new TmdbClient(http,credential(settings,env,'tmdb_api_key')??''));
  switch(input.op){
    case 'browse':return browse(env.media_root,input.path||'.');
    case 'detail':return detail(db,env.media_root,settings,providers,input.path);
    case 'episodes':return episodes(db,env.media_root,settings,providers,input.path);
    case 'thumbs':return thumbnails(db,env.media_root,settings,providers,input);
    case 'mutate':return mutateItem(db,env.media_root,input.input);
    case 'library-delete':return deleteLibrary(db,env.media_root,input.name);
    case 'app-log':return appLog(env.config_dir,input.tail);
    case 'job-log':return jobLog(env.config_dir,input.id);
    case 'cache-clear':return {cleared:db.prepare('DELETE FROM provider_cache').run().changes};
    case 'tvdb':try{return (await providers.tvdb.extended(input.kind,input.id)).data;}catch(error){throw new Error('Provider returned HTTP: TVDB lookup failed',{cause:error});}
    case 'plex':return plexRequest(db,env,{...settings,plex_token:credential(settings,env,'plex_token')},input.input);
  }
}
let db:Database.Database|undefined,config:string|undefined;
export async function handle(input:{env:Env;settings:Settings;payload:ApiInput}){
  if(!db){db=await openDatabase(input.env.config_dir);config=input.env.config_dir;}
  if(config!==input.env.config_dir)throw new Error('API worker owns one config directory');
  return apiRequest(db,input.env,input.settings,input.payload);
}
