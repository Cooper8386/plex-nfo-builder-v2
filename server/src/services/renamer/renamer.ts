import { lstat,readdir,realpath } from 'node:fs/promises';
import { basename,dirname,extname,join,relative,resolve,sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { RenameRequest,RenameItem,RenamePreview,RenameResult,RenameMove } from 'shared';
import type { Settings } from '../../config/settings.js';
import { isWithin } from '../../config/paths.js';
import { folderSnapshot,restoreSnapshot } from '../../db/queries.js';
import type { Metadata } from '../providers/normalized.js';
import type { Sidecar } from '../sidecar/format.js';
import { writeSidecar } from '../sidecar/sidecar.js';
import { mediaFolders,videoPattern } from '../scanner/layout.js';
import { parseEpisode } from '../parser/parser.js';
import { selectEpisode } from '../parser/episode-selection.js';
import { ProbeCache,type MediaInfo } from '../mediainfo/mediainfo.js';
import { renderTemplate,sanitize } from './grammar.js';
import { renameNoReplace } from './native-move.js';
import { fileStamp,checkFile } from '../cleaner/previews.js';
const probes=new ProbeCache();
const portable=(folder:string,path:string)=>relative(folder,path).split(sep).join('/');
async function sameFile(a:string,b:string) {
  try {const [x,y]=await Promise.all([lstat(a),lstat(b)]);return !x.isSymbolicLink()&&!y.isSymbolicLink()&&x.dev===y.dev&&x.ino===y.ino;}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
}
async function exists(path:string) {try{await lstat(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
async function conflict(src:string,dst:string) {return src!==dst&&await exists(dst)&&!(src.toLowerCase()===dst.toLowerCase()&&await sameFile(src,dst));}
export async function previewRename(folder:string,data:Metadata,snapshot:Sidecar,settings:Settings,input:RenameRequest,probe:(path:string)=>Promise<MediaInfo>=path=>probes.get(path)):Promise<RenamePreview> {
  folder=await realpath(folder);const items:RenameItem[]=[],seen=new Map<string,RenameItem>();
  const template=input.template?.trim()||(data.kind==='movie'?settings.rename_movie_template:settings.rename_episode_template);
  const folders=data.kind==='movie'?[{path:folder,season:null}]:await mediaFolders(folder);
  for(const location of folders)for(const entry of (await readdir(location.path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
    if(!entry.isFile()||!videoPattern.test(entry.name))continue;
    const src=join(location.path,entry.name),parsed=parseEpisode(entry.name)!,key=portable(folder,src),override=snapshot.episode_file_overrides.find(value=>value.file_path===key);
    const ep=selectEpisode(entry.name,key,data.episodes,snapshot.episode_file_overrides,snapshot.episode_overrides);
    if(data.kind==='series'&&!parsed.parsed&&!ep&&!(override?.season!=null&&override.episode!=null))continue;
    const season=data.kind==='movie'?null:override?.season??location.season??ep?.season??parsed.season;
    const episode=data.kind==='movie'?null:override?.episode??ep?.episode??parsed.episode;
    const info=await probe(src),title=sanitize(data.title),year=data.year;
    const context={...info,title,series_titleyear:year?`${title} (${year})`:title,series_cleantitle:title,movie_cleantitle:title,year,year_parens:year?`(${year})`:'',season,episode,episode_title:sanitize(ep?.title??''),episode_cleantitle:sanitize(ep?.title??''),air_date:parsed.air_date??ep?.aired??'',quality_full:info.quality,release_group:input.release_group?.trim()||info.release_group,tvdb_id:data.ids.tvdb,tmdb_id:data.ids.tmdb,imdb_id:data.ids.imdb,edition_tags:/\{edition-([^}]+)\}/i.exec(entry.name)?.[1]??'',custom_formats:''};
    // An ordinary numbered episode usually has an air date too; only the filename selects daily mode.
    const mode=input.series_type&&input.series_type!=='auto'?input.series_type:/^\[[^\]]+\].*? - \d+/.test(entry.name)?'anime':parsed.air_date?'daily':'standard';
    const chosen=data.kind==='movie'||mode==='standard'?template:mode==='daily'?input.daily_template?.trim()||settings.rename_daily_template:input.anime_template?.trim()||settings.rename_anime_template;
    const {languages: _languages,...values}=context;void _languages;
    const extension=extname(src).toLowerCase();let name=sanitize(renderTemplate(chosen,values))||entry.name;
    if(!name.toLowerCase().endsWith(extension))name+=extension;
    const dst=join(location.path,name),item:RenameItem={src,dst,src_name:entry.name,dst_name:name,season,episode,matched_title:ep?.title??null,conflict:await conflict(src,dst)?'exists':null,unchanged:src===dst};
    const prior=seen.get(dst.toLowerCase());if(prior){prior.conflict='duplicate';item.conflict='duplicate';}seen.set(dst.toLowerCase(),item);items.push(item);
  }
  return {folder_path:folder,template,items};
}
export async function companions(src:string,dst:string):Promise<RenameMove[]> {
  const stem=basename(src,extname(src)),newStem=basename(dst,extname(dst));
  const entries=await readdir(dirname(src),{withFileTypes:true});
  const stems=entries.filter(e=>e.isFile()&&videoPattern.test(e.name)).map(e=>basename(e.name,extname(e.name)).toLowerCase());
  return entries.filter(e=>e.isFile()&&e.name.toLowerCase().startsWith(stem.toLowerCase())).flatMap(e=>{
    const suffix=e.name.slice(stem.length);
    if(stems.some(other=>other.length>stem.length&&e.name.toLowerCase().startsWith(other+'.')))return [];
    return /^\.nfo$|^-thumb\.(jpg|jpeg|png|webp|gif|bmp|tbn)$|^\.(?:[^/\\]+\.)?(srt|ass|ssa|vtt|sub|idx|sup)$/i.test(suffix)?[{src:join(dirname(src),e.name),dst:join(dirname(src),newStem+suffix)}]:[];
  });
}
async function moveFile(move:RenameMove) {
  if(move.src===move.dst)return;
  if(await conflict(move.src,move.dst))throw new Error('Destination exists');
  if(move.src.toLowerCase()!==move.dst.toLowerCase())return renameNoReplace(move.src,move.dst);
  const temp=join(dirname(move.src),`.rename-${randomUUID()}.part`);
  renameNoReplace(move.src,temp);
  try{renameNoReplace(temp,move.dst);}catch(error){
    try{renameNoReplace(temp,move.src);}catch(rollback){throw new RenameRecoveryError(temp,move.src,rollback);}
    throw error;
  }
}
class RenameRecoveryError extends Error {
  constructor(readonly recoveryPath:string,readonly originalPath:string,cause:unknown){super(`Rename recovery required: original file retained at ${recoveryPath}`,{cause});}
}
export interface CapturedMove extends RenameMove {stamp:string}
export async function captureMoves(item:RenameItem):Promise<CapturedMove[]> {
  return Promise.all([{src:item.src,dst:item.dst},...await companions(item.src,item.dst)].map(async move=>({...move,stamp:await fileStamp(move.src)})));
}
export async function applyRename(db:Database.Database,folder:string,items:RenameItem[],onlySrc?:string[],captured?:Record<string,CapturedMove[]>):Promise<RenameResult> {
  folder=await realpath(folder);const result:RenameResult={ok:true,renamed:[],skipped:[],failed:[],companions_moved:[],companions_failed:[]};
  for(const item of items) {
    if(onlySrc&&!onlySrc.includes(item.src))continue;
    if(item.src===item.dst||item.conflict){result.skipped.push({src:item.src,reason:item.conflict??'unchanged'});continue;}
    const moved:RenameMove[]=[];let before:Sidecar|undefined;
    try {
      if(dirname(resolve(item.src))!==dirname(resolve(item.dst)))throw new Error('Cross-folder rename refused');
      const parent=await realpath(dirname(item.src));if(parent!==dirname(item.src)||!isWithin(folder,parent))throw new Error('Rename path outside item folder');
      if(!videoPattern.test(item.src)||!videoPattern.test(item.dst))throw new Error('Expected video filenames');
      const moves=captured?captured[item.src]!:[{src:item.src,dst:item.dst},...await companions(item.src,item.dst)];
      if(!moves)throw new Error('Source was not captured in this preview');
      if(captured)for(const move of captured[item.src]!)await checkFile(move.src,move.stamp);
      for(const move of moves){const stat=await lstat(move.src);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Expected regular source file');if(await conflict(move.src,move.dst))throw new Error('Destination exists');}
      before=folderSnapshot(db,folder);
      for(const move of moves){if(captured)await checkFile(move.src,(move as CapturedMove).stamp);await moveFile(move);moved.push(move);}
      const after=structuredClone(before),from=portable(folder,item.src),to=portable(folder,item.dst);
      for(const mapping of after.episode_file_overrides)if(mapping.file_path===from)mapping.file_path=to;
      await writeSidecar(folder,after);restoreSnapshot(db,folder,after);
      result.renamed.push(moves[0]!);result.companions_moved.push(...moves.slice(1));
    }catch(error){
      let videoRolledBack=true;
      for(const move of moved.reverse())try{await moveFile({src:move.dst,dst:move.src});}catch(rollback){if(move.src===item.src)videoRolledBack=false;result.companions_failed.push({...move,reason:'Rollback failed: '+(rollback as Error).message});}
      if(before&&(moved.length||error instanceof RenameRecoveryError))try{
        if(!videoRolledBack)for(const mapping of before.episode_file_overrides)if(mapping.file_path===portable(folder,item.src))mapping.file_path=portable(folder,item.dst);
        if(error instanceof RenameRecoveryError&&error.originalPath===item.src)for(const mapping of before.episode_file_overrides)if(mapping.file_path===portable(folder,item.src))mapping.file_path=portable(folder,error.recoveryPath);
        await writeSidecar(folder,before);restoreSnapshot(db,folder,before);
      }catch(restore){result.failed.push({src:item.src,reason:'Mapping recovery failed: '+(restore as Error).message});}
      result.failed.push({src:item.src,dst:item.dst,reason:(error as Error).message});
    }
  }
  return result;
}
