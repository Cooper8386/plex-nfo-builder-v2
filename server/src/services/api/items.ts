import { readdir,lstat } from 'node:fs/promises';
import { join,relative,sep,extname,resolve } from 'node:path';
import type Database from 'better-sqlite3';
import type { Library,Item,Binding,ItemDetailResponse,EpisodesResponse,EpisodeLocal,ThumbResponse,EpisodeOverrideRequest,EpisodeFileOverrideRequest,TagRequest } from 'shared';
import type { Settings } from '../../config/settings.js';
import { mediaPath,isWithin } from '../../config/paths.js';
import { pathBoundary } from '../../middleware/path-boundary.js';
import { folderSnapshot,restoreSnapshot,forgetFolder } from '../../db/queries.js';
import { recoverSidecar,writeSidecar } from '../sidecar/sidecar.js';
import type { Sidecar } from '../sidecar/format.js';
import type { Providers } from '../providers/providers.js';
import type { Metadata } from '../providers/normalized.js';
import { effectiveSource } from '../matcher/effective-source.js';
import { mediaFolders,videoPattern } from '../scanner/layout.js';
import { parseEpisode } from '../parser/parser.js';
import { selectEpisode } from '../parser/episode-selection.js';
import { seasonPosterProgress } from '../artwork/season-posters.js';

const invalid=(message:string)=>new Error(`API validation: ${message}`);
export async function itemTarget(db:Database.Database,root:string,path:string,exists=true){
  const folder=await pathBoundary(root,path,exists),parts=relative(await mediaPath(root,'.'),folder).split(sep);
  if(parts.length!==2||exists&&!(await lstat(folder)).isDirectory())throw invalid('Expected an item folder inside a library');
  const library=db.prepare('SELECT * FROM libraries WHERE name=?').get(parts[0]) as Library|undefined;
  if(!library)throw new Error('Library not found');
  return {folder,library,snapshot:folderSnapshot(db,folder)};
}
async function metadata(providers:Providers,settings:Settings,target:Awaited<ReturnType<typeof itemTarget>>,series=false){
  const binding=target.snapshot.binding;
  if(!binding||series&&binding.kind!=='series')throw invalid('Expected a bound series');
  const source=effectiveSource(binding,target.library,settings.metadata_source);
  try{
    const id=binding.provider==='imdb'?(binding.secondary_provider===source?binding.secondary_external_id:null)??(await providers[source].findImdb(binding.external_id,binding.kind))[0]?.id:binding.external_id;
    if(!id)throw new Error('Provider identity could not be resolved');
    const data=await providers.details(source,binding.kind,id,{language:binding.language??settings.preferred_language,secondaryTmdbId:binding.secondary_provider==='tmdb'?binding.secondary_external_id??undefined:undefined});
    return {source,id,data};
  }catch(error){throw new Error('Provider returned HTTP: Metadata lookup failed',{cause:error});}
}
async function localEpisodes(folder:string,snapshot:Sidecar,data:Metadata):Promise<EpisodeLocal[]>{
  const result:EpisodeLocal[]=[];
  for(const group of await mediaFolders(folder))for(const file of await readdir(group.path,{withFileTypes:true})){
    if(!file.isFile()||!videoPattern.test(file.name))continue;
    const path=join(group.path,file.name),key=relative(folder,path).split(sep).join('/'),parsed=parseEpisode(file.name)!;
    const override=snapshot.episode_file_overrides.find(row=>row.file_path===key),matched=selectEpisode(file.name,key,data.episodes,snapshot.episode_file_overrides,snapshot.episode_overrides);
    const season=override?.season??(parsed.parsed&&!parsed.air_date?parsed.season:null),episode=override?.episode??(parsed.parsed&&!parsed.air_date?parsed.episode:null);
    const legacy=snapshot.episode_overrides.find(row=>row.season===season&&row.episode===episode);
    let thumb:string|null=null;
    for(const extension of ['.jpg','.jpeg','.png']){const candidate=path.slice(0,-extname(path).length)+'-thumb'+extension;try{if((await lstat(candidate)).isFile()){thumb=candidate;break;}}catch{/* Missing companion. */}}
    result.push({file_path:path,file_name:file.name,parsed_season:parsed.season,parsed_episode:parsed.episode,effective_season:season,effective_episode:episode,override_episode_id:override?.external_id??legacy?.tvdb_episode_id??null,matched_episode_id:matched?.id??null,matched_season:matched?.season??null,matched_number:matched?.episode??null,matched_title:matched?.title??null,matched_image:matched?.image??null,local_thumb:thumb,unparsed:!parsed.parsed,has_file_override:Boolean(override)});
  }
  return result.sort((a,b)=>a.file_path.localeCompare(b.file_path));
}
export async function episodes(db:Database.Database,root:string,settings:Settings,providers:Providers,path:string):Promise<EpisodesResponse>{
  const target=await itemTarget(db,root,path),{source,data}=await metadata(providers,settings,target,true);
  return {path:target.folder,provider:source,locals:await localEpisodes(target.folder,target.snapshot,data),tvdb_episodes:data.episodes.map(e=>({id:e.id,season:e.season,number:e.episode,name:e.title,aired:e.aired,image:e.image}))};
}
export async function detail(db:Database.Database,root:string,settings:Settings,providers:Providers,path:string):Promise<ItemDetailResponse>{
  const target=await itemTarget(db,root,path),{folder,snapshot,library}=target;
  const state=db.prepare('SELECT * FROM item_state WHERE folder_path=?').get(folder) as Item|undefined;
  const binding=db.prepare('SELECT * FROM bindings WHERE folder_path=?').get(folder) as Binding|undefined;
  const tags={tvdb:[] as string[],tmdb:[] as string[],custom:snapshot.custom_tags};let count:number|null=null,provider:ItemDetailResponse['provider_used']=binding?.provider??null;
  if(binding)try{
    const {source,data}=await metadata(providers,settings,target);provider=source;
    if(binding.kind==='series')count=new Set((await localEpisodes(folder,snapshot,data)).map(row=>row.matched_episode_id).filter(Boolean)).size;
    tags[source]=data.genres;
    const tmdbId=source==='tmdb'?data.id:binding.secondary_provider==='tmdb'?binding.secondary_external_id:data.ids.tmdb;
    if(tmdbId)try{tags.tmdb=[...new Set([...tags.tmdb,...await providers.tmdb.keywords(binding.kind,tmdbId)])];}catch{/* Tags are best effort. */}
  }catch{/* Detail remains available while a provider is unavailable. */}
  const overrides:ItemDetailResponse['overrides']={};for(const value of snapshot.overrides){const scope=value.scope as keyof typeof overrides;(overrides[scope]??={})[value.field]=value.value;}
  const artwork_files=(await readdir(folder,{withFileTypes:true})).filter(entry=>entry.isFile()&&/^(poster\.jpg|background\.jpg|banner\.jpg|clearlogo\.png|Season(?:\d+|-specials)-poster\.jpg)$/i.test(entry.name)).map(entry=>join(folder,entry.name)).sort();
  const progress=(binding?.kind??state?.kind)==='series'?await seasonPosterProgress(folder,snapshot.artwork_selections,snapshot.episode_file_overrides):{state:'not_applicable' as const,required_seasons:[],selected_seasons:[],missing_seasons:[],unresolved_files:[]};
  return {path:folder,binding:binding?{...binding,source_locked:Boolean(binding.source_locked)}:null,state:state??null,artwork_files,overrides,provider_episode_count:count,provider_used:provider,tags,library_kind:library.kind,season_poster_progress:progress};
}
export async function thumbnails(db:Database.Database,root:string,settings:Settings,providers:Providers,input:{path:string;season:number;episode:number}):Promise<ThumbResponse>{
  const target=await itemTarget(db,root,input.path),{source,id,data}=await metadata(providers,settings,target,true),episode=data.episodes.find(e=>e.season===input.season&&e.episode===input.episode);
  const selection=target.snapshot.artwork_selections.find(row=>row.slot===`episode-thumb-${episode?.id}`)?.url??null;
  let images:Awaited<ReturnType<Providers['tmdb']['episodeImages']>>=[];
  if(source==='tmdb')try{images=await providers.tmdb.episodeImages(id,input.season,input.episode);}catch(error){throw new Error('Provider returned HTTP: Episode images lookup failed',{cause:error});}
  const candidates:ThumbResponse['candidates']=images.map(image=>({url:image.url,thumb:image.thumb?.replace('/original/','/w300/')??null,width:image.width,height:image.height,language:image.language,vote_average:image.score,is_default:image.url===episode?.image,selected:image.url===selection}));
  if(episode?.image&&!candidates.some(c=>c.url===episode.image))candidates.unshift({url:episode.image,thumb:episode.image,width:null,height:null,language:null,vote_average:null,is_default:true,selected:episode.image===selection});
  return {...input,path:target.folder,provider:source,external_id:episode?.id??null,candidates,current_selection:selection,note:source==='tvdb'?'TVDB supplies one still per episode. Choose TMDB as the source to browse multiple stills.':null};
}
export type ItemMutation={op:'tag-add';request:TagRequest}|{op:'tag-delete';request:TagRequest}|{op:'episode-override';request:EpisodeOverrideRequest}|{op:'file-override';request:EpisodeFileOverrideRequest}|{op:'remove';request:{folder_path:string}};
export async function mutateItem(db:Database.Database,root:string,input:ItemMutation){
  const {folder}=await itemTarget(db,root,input.request.folder_path,input.op!=='remove');
  if(input.op==='remove'){forgetFolder(db,folder);return {ok:true};}
  await recoverSidecar(db,folder);const before=folderSnapshot(db,folder),next=structuredClone(before);
  if(input.op==='tag-add'||input.op==='tag-delete'){
    const tag=input.request.tag.trim();if(!tag)throw invalid('Tag must not be blank');
    next.custom_tags=next.custom_tags.filter(value=>value.toLowerCase()!==tag.toLowerCase());if(input.op==='tag-add')next.custom_tags.push(tag);
  }else if(input.op==='episode-override'){
    const request=input.request;if(!Number.isInteger(request.season)||request.season<0||!Number.isInteger(request.episode)||request.episode<0)throw invalid('Invalid episode number');
    next.episode_overrides=next.episode_overrides.filter(row=>row.season!==request.season||row.episode!==request.episode);
    if(request.tvdb_episode_id)next.episode_overrides.push({season:request.season,episode:request.episode,tvdb_episode_id:request.tvdb_episode_id});
  }else{
    const request=input.request,file=await mediaPath(root,resolve(folder,request.file_path));
    if(file===folder||!isWithin(folder,file)||!(await lstat(file)).isFile()||!videoPattern.test(file))throw invalid('Expected a media file under the item folder');
    const key=relative(folder,file).split(sep).join('/');next.episode_file_overrides=next.episode_file_overrides.filter(row=>row.file_path!==key);
    if(!request.clear)next.episode_file_overrides.push({file_path:key,season:request.season??null,episode:request.episode??null,external_id:request.external_id??null});
  }
  await writeSidecar(folder,next);try{restoreSnapshot(db,folder,next);}catch(error){await writeSidecar(folder,before);throw error;}return {ok:true};
}
export async function deleteLibrary(db:Database.Database,root:string,name:string){
  if(!db.prepare('SELECT 1 FROM libraries WHERE name=?').get(name))throw new Error('Library not found');
  const library=await pathBoundary(root,name,false);if(relative(await mediaPath(root,'.'),library).split(sep).length!==1)throw invalid('Invalid library path');
  const tables=['item_state','bindings','nfo_overrides','artwork_selections','active_artwork','custom_artwork','episode_overrides','episode_file_overrides','custom_tags','watcher_review'];
  return db.transaction(()=>{const folders=new Set<string>();let items=0,bindings=0;
    for(const table of tables)for(const row of db.prepare(`SELECT DISTINCT folder_path FROM ${table}`).all() as {folder_path:string}[])if(isWithin(library,row.folder_path)){folders.add(row.folder_path);if(table==='item_state')items++;if(table==='bindings')bindings++;}
    for(const folder of folders)forgetFolder(db,folder);db.prepare('DELETE FROM libraries WHERE name=?').run(name);return {ok:true,items,bindings};
  })();
}
