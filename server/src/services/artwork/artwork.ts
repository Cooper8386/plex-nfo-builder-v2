import { createHash } from 'node:crypto';
import { basename, extname, join, relative, sep } from 'node:path';
import { mkdir, readFile, readdir, realpath, stat, lstat, unlink } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import type { ArtworkCandidatesResponse, ArtworkLanguagesResponse, CustomArtwork, SeasonPosterProgress } from 'shared';
import { mediaPath, isWithin } from '../../config/paths.js';
import type { Settings } from '../../config/settings.js';
import { folderSnapshot, getBinding, restoreSnapshot } from '../../db/queries.js';
import { recoverSidecar, writeSidecar } from '../sidecar/sidecar.js';
import { sidecarSchema, type Sidecar } from '../sidecar/format.js';
import type { Metadata, Artwork } from '../providers/normalized.js';
import type { Providers } from '../providers/providers.js';
import type { FanartClient } from '../providers/fanart.js';
import { resolveArtwork } from './resolver.js';
import { seasonPosterProgress } from './season-posters.js';
import { downloadArtwork, maxArtworkBytes, saveArtwork } from './download.js';
import { mediaFolders, videoPattern } from '../scanner/layout.js';
import { selectEpisode } from '../parser/episode-selection.js';
import type { NfoOptions } from '../nfo/nfo.js';
import { checkFile } from '../cleaner/previews.js';

export const slotPattern = /^(poster|background|banner|clearlogo|season-\d{2}-poster|episode-thumb-[A-Za-z0-9_-]+)$/;
export type ArtworkInput = {op:'candidates'|'progress'|'file';path:string}|{op:'languages'}|
  {op:'select';folder_path:string;slot:string;url:string;language?:string|null;score?:number|null}|
  {op:'clear';folder_path:string;slot?:string}|{op:'custom-list';folder_path:string}|
  {op:'custom-file'|'custom-delete';id:string}|
  {op:'register';folder_path:string;slot?:string;url?:string;data?:string;content_type?:string};
const customPattern = /^\/api\/artwork\/custom\/([a-f0-9]{40})$/;
const imageTypes: Record<string,string> = {'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/gif':'.gif'};
export class ArtworkError extends Error { constructor(message: string) {super(`Artwork validation: ${message}`);} }
const validateSlot = (slot: string) => {if (!slotPattern.test(slot)) throw new ArtworkError('Invalid slot');return slot;};
function validateUrl(value: string, allowUpload = true) {
  if (allowUpload && customPattern.test(value)) return value;
  try { const url = new URL(value); if (['http:','https:'].includes(url.protocol) && !url.username && !url.password) return url.href; } catch { /* Validation below */ }
  throw new ArtworkError('Expected an http(s) URL');
}
const emptyProgress: SeasonPosterProgress = {state:'not_applicable',required_seasons:[],selected_seasons:[],missing_seasons:[],unresolved_files:[]};

// Called in the serial mutation worker, shared with binding and NFO override changes.
export class ArtworkService {
  constructor(private db: Database.Database, private root: string, private config: string, private settings: Settings, private providers: Providers, private fanart: FanartClient) {}
  request(input: ArtworkInput) {
    switch(input.op) {
      case 'select': return this.select(input);
      case 'clear': return this.clear(input);
      case 'register': return this.register(input);
      case 'custom-list': return this.customList(input.folder_path);
      case 'custom-delete': return this.removeCustom(input.id);
      case 'custom-file': return this.file(input.id,true);
      case 'file': return this.file(input.path);
      case 'candidates': return this.candidates(input.path);
      case 'progress': return this.progress(input.path);
      case 'languages': return this.languages();
    }
  }
  private async folder(value: string) {
    const folder = await mediaPath(this.root,value);
    if (!(await stat(folder)).isDirectory()) throw new ArtworkError('Expected an item folder');
    return folder;
  }
  async select(input: {folder_path:string;slot:string;url:string;language?:string|null;score?:number|null}) {
    validateSlot(input.slot); const url = validateUrl(input.url);
    const folder = await this.folder(input.folder_path);
    if (customPattern.test(url)) await this.customFile(customPattern.exec(url)![1]!);
    return this.persist(folder,selections=>[...selections.filter(s=>s.slot!==input.slot),{slot:input.slot,url,language:input.language??null,score:input.score??null}]);
  }
  async clear(input: {folder_path:string;slot?:string}) {
    if (input.slot !== undefined) validateSlot(input.slot);
    return this.persist(await this.folder(input.folder_path),selections=>input.slot?selections.filter(s=>s.slot!==input.slot):[]);
  }
  private async persist(folder: string, change: (selections: Sidecar['artwork_selections'])=>Sidecar['artwork_selections']) {
    await recoverSidecar(this.db,folder);
    const before = folderSnapshot(this.db,folder), next = sidecarSchema.parse({...before,artwork_selections:change(before.artwork_selections)});
    await writeSidecar(folder,next);
    try {restoreSnapshot(this.db,folder,next);} catch(error) {await writeSidecar(folder,before);throw error;}
    return {ok:true as const};
  }
  async progress(path: string) {
    const folder = await this.folder(path), snapshot = folderSnapshot(this.db,folder);
    return snapshot.binding?.kind === 'movie' ? emptyProgress : seasonPosterProgress(folder,snapshot.artwork_selections,snapshot.episode_file_overrides);
  }
  async candidates(path: string): Promise<ArtworkCandidatesResponse> {
    const folder = await this.folder(path), binding = getBinding(this.db,folder);
    if (!binding) throw new ArtworkError('Bind this item before selecting provider artwork');
    let source = binding.provider, id = binding.external_id;
    if (source === 'imdb') {
      const match = (await this.providers.tmdb.findImdb(id,binding.kind))[0];
      if (!match) throw new ArtworkError('Could not resolve IMDb artwork; pin a secondary provider ID');
      source = 'tmdb'; id = match.id;
    }
    const data = await this.providers.client(source).details(binding.kind,id,{language:binding.language??this.settings.preferred_language});
    const {artwork,warnings} = await this.aggregate(data,binding.secondary_provider,binding.secondary_external_id);
    const snapshot = folderSnapshot(this.db,folder), resolved = resolveArtwork(artwork,this.settings,source,snapshot.artwork_selections);
    return {path:folder,candidates:resolved.candidates,selections:snapshot.artwork_selections,season_poster_progress:binding.kind==='series'?await seasonPosterProgress(folder,snapshot.artwork_selections,snapshot.episode_file_overrides):emptyProgress,warnings};
  }
  async aggregate(data: Metadata, secondary: 'tvdb'|'tmdb'|null = null, secondaryId: string|null = null, force = false) {
    const ids = {...data.ids,...(secondary && secondaryId?{[secondary]:secondaryId}:{})};
    const artwork: Artwork[] = [...data.artwork], warnings: string[] = [];
    const other = data.provider === 'tvdb' ? 'tmdb' : 'tvdb';
    if (ids[other] && (other !== 'tmdb' || this.settings.tmdb_artwork_enabled)) {
      try {artwork.push(...(await this.providers.client(other).details(data.kind,ids[other]!,{force,language:this.settings.preferred_language})).artwork);}
      catch {warnings.push(`${other} artwork unavailable`);}
    }
    if (this.settings.fanart_enabled) {
      const id = data.kind === 'series' ? ids.tvdb : ids.tmdb ?? ids.imdb;
      if (id) try {artwork.push(...await this.fanart.artwork(data.kind,id,force));} catch {warnings.push('fanart artwork unavailable');}
    }
    return {artwork,warnings};
  }
  async languages(): Promise<ArtworkLanguagesResponse> {
    const [tvdb,tmdb] = await Promise.all([this.providers.tvdb.languages().catch(()=>[]),this.providers.tmdb.languages().catch(()=>[])]);
    return {tvdb,tmdb};
  }
  async customList(value: string) {
    const folder = await this.folder(value);
    const items = this.db.prepare('SELECT * FROM custom_artwork WHERE folder_path=? ORDER BY created_at,id').all(folder) as Omit<CustomArtwork,'url'>[];
    return {items:items.map(row=>({...row,url:row.source==='upload'?`/api/artwork/custom/${row.id}`:row.origin!}))};
  }
  async register(input: {folder_path:string;slot?:string;url?:string;data?:string;content_type?:string}) {
    const folder = await this.folder(input.folder_path), slot = validateSlot(input.slot??'poster');
    const type = input.content_type??'', bytes = input.data === undefined?null:Buffer.from(input.data,'base64');
    if (bytes && (!bytes.length || !imageTypes[type])) throw new ArtworkError('Empty or unsupported image type');
    if (bytes && bytes.length>maxArtworkBytes) throw new Error('Artwork too large');
    const origin = bytes?null:validateUrl(input.url??'',false);
    const id = createHash('sha1').update(folder+'\0'+slot+'\0').update(bytes??origin!).digest('hex');
    let file: string|null = null;
    if (bytes) {
      const directory = join(this.config,'custom-artwork'); await mkdir(directory,{recursive:true});
      if (!isWithin(await realpath(this.config),await realpath(directory))) throw new ArtworkError('Custom artwork directory outside config');
      file = join(directory,id+imageTypes[type]); await saveArtwork(file,bytes);
    }
    this.db.prepare('INSERT INTO custom_artwork VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').run(id,folder,slot,bytes?'upload':'url',origin,file,bytes?type:null,bytes?.length??null,Date.now());
    return (await this.customList(folder)).items.find(item=>item.id===id)!;
  }
  async customFile(id: string) {
    if (!/^[a-f0-9]{40}$/.test(id)) throw new ArtworkError('Invalid custom artwork ID');
    // The deterministic asset survives a database wipe along with its saved sidecar URL.
    const directory = join(this.config,'custom-artwork');
    if (!(await lstat(directory)).isDirectory()) throw new ArtworkError('Custom artwork directory must not be a symlink');
    const name = (await readdir(directory)).find(name=>Object.values(imageTypes).some(ext=>name===id+ext));
    if (!name) throw new Error('Artwork file not found');
    const path = join(await realpath(directory),name);
    if (!isWithin(await realpath(this.config),path) || !(await lstat(path)).isFile()) throw new ArtworkError('Custom artwork must be a regular file inside config');
    return path;
  }
  async removeCustom(id: string, capturedFile?: {path:string;stamp:string}) {
    const row = this.db.prepare('SELECT * FROM custom_artwork WHERE id=?').get(id) as Omit<CustomArtwork,'url'>|undefined;
    if (!row) throw new Error('Artwork file not found');
    const url = row.source==='upload'?`/api/artwork/custom/${id}`:row.origin!;
    const references = this.db.prepare('SELECT DISTINCT folder_path FROM artwork_selections WHERE url=?').all(url) as {folder_path:string}[];
    for (const reference of references) await this.persist(await this.folder(reference.folder_path),selections=>selections.filter(selection=>selection.url!==url));
    if (row.source === 'upload') {
      const file = capturedFile?.path ?? await this.customFile(id);
      if (capturedFile) await checkFile(file,capturedFile.stamp);
      await unlink(file);
    }
    this.db.prepare('DELETE FROM custom_artwork WHERE id=?').run(id); return {ok:true as const};
  }
  async file(path: string, custom = false) {
    const safe = custom?await this.customFile(path):await mediaPath(this.root,path);
    const info = await stat(safe);
    if (!info.isFile()) throw new Error('Artwork file not found');
    if (info.size>maxArtworkBytes) throw new Error('Artwork too large');
    return {data:(await readFile(safe)).toString('base64'),content_type:Object.entries(imageTypes).find(([,ext])=>ext===extname(safe).toLowerCase())?.[0]??'application/octet-stream'};
  }
  async download(url: string, destination: string) {
    const custom = customPattern.exec(url);
    if (custom) await saveArtwork(destination,await readFile(await this.customFile(custom[1]!)));
    else await downloadArtwork(url,destination);
  }
  async write(folder: string, data: Metadata, urls: Record<string,string>, mappings: Pick<NfoOptions,'fileOverrides'|'episodeOverrides'> = {}) {
    const safe = await this.folder(folder);
    const result = await writeArtworkSet(safe,data,urls,(url,path)=>this.download(url,path),mappings);
    this.db.transaction(()=>{
      for (const [slot,path] of Object.entries(result.files)) this.db.prepare('INSERT INTO active_artwork VALUES (?,?,?,?) ON CONFLICT(folder_path,slot) DO UPDATE SET source_path=excluded.source_path,updated_at=excluded.updated_at').run(safe,slot,path,Date.now());
    })();
    return result;
  }
}

// Phase 15 calls this with the same chosen URL map passed to NFO rendering.
export async function writeArtworkSet(folder: string, data: Metadata, urls: Record<string,string>, download = downloadArtwork, mappings: Pick<NfoOptions,'fileOverrides'|'episodeOverrides'> = {}) {
  const files: Record<string,string> = {}, nfoUrls = {...urls};
  for (const [slot,url] of Object.entries(urls)) {
    let name = ({poster:'poster.jpg',background:'background.jpg',banner:'banner.jpg',clearlogo:'clearlogo.png'} as Record<string,string>)[slot];
    const season = /^season-(\d{2})-poster$/.exec(slot);
    if (season) name = season[1]==='00'?'season-specials-poster.jpg':`Season${season[1]}-poster.jpg`;
    if (!name) continue;
    const path = join(folder,name); await download(url,path); files[slot] = path;
    if (customPattern.test(url)) nfoUrls[slot] = name;
  }
  if (data.kind==='series') for (const group of await mediaFolders(folder)) {
    for (const file of await readdir(group.path,{withFileTypes:true})) {
      if (!file.isFile() || !videoPattern.test(file.name)) continue;
      const ep = selectEpisode(file.name,relative(folder,join(group.path,file.name)).split(sep).join('/'),data.episodes,mappings.fileOverrides,mappings.episodeOverrides);
      if (!ep) continue;
      const slot = `episode-thumb-${ep.id}`, url = urls[slot]??ep.image;
      if (!url) continue;
      const path = join(group.path,basename(file.name,extname(file.name))+'-thumb.jpg');
      await download(url,path); files[slot] = path; nfoUrls[slot] = customPattern.test(url)?basename(path):url;
    }
  }
  return {files,urls:nfoUrls};
}
