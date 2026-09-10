import type { FastifyInstance } from 'fastify';
import type { BrowseResponse,ItemDetailResponse,EpisodesResponse,ThumbResponse,ThumbQuery,TagRequest,EpisodeOverrideRequest,EpisodeFileOverrideRequest,EpisodeThumbRequest,OkResponse,Job,JobsResponse,LogResponse,UpdateSettingsRequest,SettingsResponse,PlexRefreshRequest,VersionResponse } from 'shared';
import type { ApiClient } from '../services/api/client.js';
import type { MatcherClient } from '../services/matcher/client.js';
import type { ScannerClient } from '../services/scanner/client.js';
import type { BuilderClient } from '../services/builder/client.js';
import type { Watcher } from '../services/watcher/watcher.js';
import type { Settings } from '../config/settings.js';
import { publicSettings,watcherSettings } from '../config/settings.js';
import type { Env } from '../config/env.js';
import type { PlexTestResponse,PlexSectionsResponse,PlexRefreshResponse,ScanLibraryResponse,ProviderPayload } from 'shared';
import type { RecordRequest,RecordResponse } from 'shared';
import { confirmationProperties,confirmationQuery } from './danger.js';
const string={type:'string'},nonblank={type:'string',minLength:1},integer={type:'integer',minimum:0};
const object=(required:string[],properties:Record<string,unknown>)=>({type:'object',required,properties,additionalProperties:false});
const nullable=(type:unknown)=>({anyOf:[type,{type:'null'}]});
const pathQuery={querystring:object(['path'],{path:nonblank})};
function publicJob(job:Job):Job{return {id:job.id,kind:job.kind,folder:job.folder,status:job.status,progress:job.progress,total:job.total,started_at:job.started_at,finished_at:job.finished_at,messages:job.messages};}
export function apiRoutes(app:FastifyInstance,api:ApiClient,matcher:MatcherClient,scanner:ScannerClient,builder:BuilderClient,watcher:Watcher,env:Env,settings:()=>Settings,save:(patch:Partial<Settings>)=>Promise<void>,version:string){
  app.get<{Reply:VersionResponse}>('/api/version',async()=>({version,name:'plex-nfo-builder',repo:'Cooper8386/plex-nfo-builder-v2'}));
  app.get<{Reply:SettingsResponse}>('/api/settings',async()=>publicSettings(settings(),env) as unknown as SettingsResponse);
  app.post<{Body:UpdateSettingsRequest;Reply:OkResponse}>('/api/settings',{schema:{body:{type:'object'}}},async request=>{
    const before=JSON.stringify(watcherSettings(settings(),env));await save(request.body);
    if(before!==JSON.stringify(watcherSettings(settings(),env)))await watcher.reload();return {ok:true};
  });
  app.get<{Querystring:{path?:string};Reply:BrowseResponse}>('/api/browse',{schema:{querystring:object([],{path:string})}},request=>api.run({op:'browse',path:request.query.path}));
  app.get<{Querystring:{path:string};Reply:ItemDetailResponse}>('/api/items/detail',{schema:pathQuery},request=>api.run({op:'detail',path:request.query.path}));
  app.post<{Body:TagRequest;Reply:OkResponse}>('/api/items/tags',{schema:{body:object(['folder_path','tag'],{folder_path:nonblank,tag:nonblank})}},request=>matcher.api({op:'mutate',input:{op:'tag-add',request:request.body}}));
  app.delete<{Querystring:TagRequest;Reply:OkResponse}>('/api/items/tags',{schema:{querystring:object(['folder_path','tag'],{folder_path:nonblank,tag:nonblank})}},request=>matcher.api({op:'mutate',input:{op:'tag-delete',request:request.query}}));
  app.post<{Body:{folder_path:string};Reply:OkResponse}>('/api/items/remove',{schema:{body:object(['folder_path'],{folder_path:nonblank})}},request=>matcher.api({op:'mutate',input:{op:'remove',request:request.body}}));
  app.delete<{Params:{name:string};Querystring:Partial<RecordRequest>;Reply:RecordResponse}>('/api/libraries/:name',{schema:confirmationQuery},async request=>{const result=await matcher.preview({...request.query,op:'library-delete',library:request.params.name});if('ok' in result)await watcher.reload();return result;});
  app.post<{Params:{name:string};Reply:ScanLibraryResponse}>('/api/libraries/:name/scan',async request=>{
    if(!(await scanner.libraries()).some(library=>library.name===request.params.name))throw new Error('Library not found');
    void scanner.scan(request.params.name).catch(()=>app.log.error('Background library scan failed'));return {ok:true,scheduled:true};
  });
  app.get<{Reply:JobsResponse}>('/api/jobs',async()=>({jobs:(await builder.queue.list()).reverse().slice(0,200).map(publicJob)}));
  app.get<{Params:{id:string};Reply:Job}>('/api/jobs/:id',async request=>{const job=await builder.queue.get(request.params.id);if(!job)throw Object.assign(new Error('Job not found'),{statusCode:404});return publicJob(job);});
  app.get<{Params:{id:string};Reply:string}>('/api/jobs/:id/log',async(request,reply)=>reply.type('text/plain; charset=utf-8').send(await api.run<string>({op:'job-log',id:request.params.id})));
  app.get<{Querystring:{path:string};Reply:EpisodesResponse}>('/api/episodes',{schema:pathQuery},request=>api.run({op:'episodes',path:request.query.path}));
  app.post<{Body:EpisodeOverrideRequest;Reply:OkResponse}>('/api/episodes/override',{schema:{body:object(['folder_path','season','episode'],{folder_path:nonblank,season:integer,episode:integer,tvdb_episode_id:nullable(nonblank)})}},request=>matcher.api({op:'mutate',input:{op:'episode-override',request:request.body}}));
  app.post<{Body:EpisodeFileOverrideRequest;Reply:OkResponse}>('/api/episodes/override-file',{schema:{body:object(['folder_path','file_path'],{folder_path:nonblank,file_path:nonblank,season:nullable(integer),episode:nullable(integer),external_id:nullable(nonblank),clear:{type:'boolean'}})}},request=>matcher.api({op:'mutate',input:{op:'file-override',request:request.body}}));
  app.get<{Querystring:ThumbQuery;Reply:ThumbResponse}>('/api/episodes/thumb-candidates',{schema:{querystring:object(['path','season','episode'],{path:nonblank,season:integer,episode:integer})}},request=>api.run({op:'thumbs',...request.query}));
  app.post<{Body:EpisodeThumbRequest;Reply:OkResponse}>('/api/episodes/thumb-select',{schema:{body:object(['folder_path','external_id'],{folder_path:nonblank,external_id:nonblank,url:nullable(nonblank)})}},request=>{
    const {folder_path,external_id,url}=request.body,slot=`episode-thumb-${external_id}`;
    return matcher.artwork(url?{op:'select',folder_path,slot,url}:{op:'clear',folder_path,slot});
  });
  app.get<{Querystring:{tail?:number};Reply:LogResponse}>('/api/logs/app',{schema:{querystring:object([],{tail:{type:'integer'}})}},request=>api.run({op:'app-log',tail:request.query.tail}));
  for(const kind of ['series','movie'] as const)app.get<{Params:{id:string};Reply:ProviderPayload}>(`/api/tvdb/${kind}/:id`,request=>api.run({op:'tvdb',kind,id:request.params.id}));
  app.post<{Body:Partial<RecordRequest>;Reply:RecordResponse}>('/api/tvdb/cache/clear',{schema:{body:{type:'object',properties:confirmationProperties}}},r=>matcher.preview({...r.body,op:'cache-clear'}));
  app.get<{Reply:PlexTestResponse}>('/api/plex/test',()=>api.run({op:'plex',input:{op:'test'}}));
  app.get<{Reply:PlexSectionsResponse}>('/api/plex/sections',()=>api.run({op:'plex',input:{op:'sections'}}));
  app.post<{Body:PlexRefreshRequest;Reply:PlexRefreshResponse}>('/api/plex/refresh',{schema:{body:object(['path'],{path:string,delay_seconds:{type:'number'}})}},request=>api.run({op:'plex',input:{op:'refresh',...request.body}}));
}
