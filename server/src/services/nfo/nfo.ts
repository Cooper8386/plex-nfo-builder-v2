import { basename, extname, join, relative, sep } from 'node:path';
import { readdir, open } from 'node:fs/promises';
import type { MetadataSource } from 'shared';
import type { Metadata, Episode, Season } from '../providers/normalized.js';
import { atomicWrite } from '../fs/atomic.js';
import { mediaFolders, videoPattern } from '../scanner/layout.js';
import { selectEpisode } from '../parser/episode-selection.js';
import type { Sidecar } from '../sidecar/format.js';
import { filterCast } from './cast.js';
import { withProvenance } from './provenance.js';
import { overridden, type Overrides } from './overrides.js';
export interface NfoOptions { overrides?: Overrides; urls?: Record<string,string>; tags?: string[]; overwriteForeign?:boolean; fileOverrides?:Sidecar['episode_file_overrides']; episodeOverrides?:Sidecar['episode_overrides'] }
// eslint-disable-next-line no-control-regex -- XML 1.0 excludes these control characters.
const xmlValue = (v: unknown) => String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'');
const escape = (v: unknown) => xmlValue(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const el = (tag: string, value: unknown, attrs: Record<string,string> = {}, indent = 1) => value === null || value === undefined || value === '' ? '' : `${'  '.repeat(indent)}<${tag}${Object.entries(attrs).map(([k,v])=>` ${k}="${escape(v)}"`).join('')}>${escape(value)}</${tag}>\n`;
const uid = (id: string | undefined, provider: string, primary: boolean) => {const clean=xmlValue(id??'').trim();return clean&&!['0','None'].includes(clean) ? el('uniqueid',clean,{type:provider,...(primary?{default:'true'}:{})}) : '';};
function textFields(scope: string, values: {title:string;plot:string;originaltitle?:string;sorttitle?:string;tagline?:string}, options: NfoOptions) {
  return (['title','originaltitle','sorttitle','plot','tagline'] as const).map(field=>el(field,overridden(options.overrides??[],scope,field,values[field]??''))).join('');
}
function artwork(urls: Record<string,string> = {}) {
  return el('thumb',urls.poster,{aspect:'poster'}) + el('thumb',urls.banner,{aspect:'banner'}) + (urls.background ? `  <fanart>\n${el('thumb',urls.background,{},2)}  </fanart>\n` : '');
}
export function renderItem(data: Metadata, options: NfoOptions = {}) {
  const scope = data.kind, root = scope === 'series' ? 'tvshow' : 'movie';
  let body = textFields(scope,{title:data.title,plot:data.plot,originaltitle:data.original_title,sorttitle:data.sort_title,tagline:data.tagline},options);
  body += el('year',data.year)+el('premiered',data.aired)+el('runtime',data.runtime)+el('rating',data.rating)+el('mpaa',data.content_rating)+el('status',data.status);
  for (const studio of data.studios) body += el('studio',studio);
  const seen = new Set<string>();
  for (const genre of [...data.genres,...options.tags??[]]) { const key=genre.trim().toLowerCase(); if(key&&!seen.has(key)){seen.add(key);body+=el('genre',genre);} }
  for (const tag of options.tags??[]) body += el('tag',tag);
  const ids = {...data.ids,[data.provider]:data.id};
  for (const [provider,id] of Object.entries(ids)) body += uid(id,provider,provider===data.provider);
  body += artwork(options.urls);
  for (const actor of filterCast(data.cast)) body += `  <actor>\n${el('name',actor.name,{},2)}${el('role',actor.character,{},2)}${el('order',actor.order,{},2)}${el('thumb',actor.image,{},2)}  </actor>\n`;
  return withProvenance(`<${root}>\n${body}</${root}>\n`,data.id);
}
export function renderEpisode(episode: Episode, provider: MetadataSource, options: NfoOptions = {}) {
  const body = textFields(`episode-${episode.id}`,episode,options)+el('season',episode.season)+el('episode',episode.episode)+el('aired',episode.aired)+el('runtime',episode.runtime)+uid(episode.id,provider,true)+el('thumb',options.urls?.thumb??episode.image);
  return withProvenance(`<episodedetails>\n${body}</episodedetails>\n`,episode.id);
}
export function renderSeason(season: Season, options: NfoOptions = {}) {
  const scope = `season-${String(season.season).padStart(2,'0')}`, hasOverride = options.overrides?.some(v=>v.scope===scope&&v.value);
  if (season.season === 0 && !hasOverride || !season.title && !season.plot && !hasOverride) return null;
  return withProvenance(`<season>\n${textFields(scope,season,options)}${el('seasonnumber',season.season)}${el('thumb',options.urls?.poster)}</season>\n`,season.id);
}
export const writeNfo = (path: string, content: string) => atomicWrite(path,content);
export async function writeNfos(folder: string, data: Metadata, options: NfoOptions = {}) {
  const written: string[] = [];
  const write = async (path: string, text: string) => {
    if (options.overwriteForeign===false) {
      let file;
      try {file=await open(path,'r');} catch(error) {if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;}
      if (file) try {const buffer=Buffer.alloc(2048);const {bytesRead}=await file.read(buffer,0,2048,0);if (!buffer.subarray(0,bytesRead).toString().includes('<!-- plex-nfo-builder')) return;} finally {await file.close();}
    }
    await writeNfo(path,text);written.push(path);
  };
  if (data.kind === 'series') await write(join(folder,'tvshow.nfo'),renderItem(data,options));
  for (const group of await mediaFolders(folder)) {
    const videos = (await readdir(group.path,{withFileTypes:true})).filter(e=>e.isFile()&&videoPattern.test(e.name));
    if (data.kind === 'movie') {
      if (group.path !== folder) continue;
      if (!videos.length) await write(join(folder,'movie.nfo'),renderItem(data,options));
      for (const video of videos) await write(join(folder,basename(video.name,extname(video.name))+'.nfo'),renderItem(data,options));
    } else {
      if (group.season !== null) {
        const season=data.seasons.find(s=>s.season===group.season)??{id:'',season:group.season,title:'',plot:'',artwork:[]};
        const seasonUrl=options.urls?.[`season-${String(group.season).padStart(2,'0')}-poster`]??'';
        const poster=seasonUrl&&!/^[a-z][a-z0-9+.-]*:|^\//i.test(seasonUrl)?join(relative(group.path,folder),seasonUrl).split(sep).join('/'):seasonUrl;
        const rendered=renderSeason(season,{...options,urls:{poster}}); if(rendered) await write(join(group.path,'season.nfo'),rendered);
      }
      for (const video of videos) {
        const episode=selectEpisode(video.name,relative(folder,join(group.path,video.name)).split(sep).join('/'),data.episodes,options.fileOverrides,options.episodeOverrides);
        if (episode) await write(join(group.path,basename(video.name,extname(video.name))+'.nfo'),renderEpisode(episode,data.provider,{...options,urls:{thumb:options.urls?.[`episode-thumb-${episode.id}`]??episode.image??''}}));
      }
    }
  }
  return written;
}
