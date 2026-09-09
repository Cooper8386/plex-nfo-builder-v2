import { basename, relative, sep } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import type { AutoBulkRequest, AutoBulkResponse, AutoMatchResult, BindRequest, SetSourceRequest, SetSecondaryRequest, MatchSearchQuery, MatchSearchResponse, Library, ItemKind, MetadataSource } from 'shared';
import type { Settings } from '../../config/settings.js';
import { mediaPath } from '../../config/paths.js';
import { folderSnapshot, getBinding, putBinding } from '../../db/queries.js';
import { bindingSchema, type Binding } from '../sidecar/format.js';
import { recoverSidecar, writeSidecar } from '../sidecar/sidecar.js';
import { scanLibrary } from '../scanner/scanner.js';
import { detectKind, videoPattern } from '../scanner/layout.js';
import { parseFolder, parseMovie } from '../parser/parser.js';
import type { MetadataProvider, SearchResult } from '../providers/normalized.js';
import { effectiveSource } from './effective-source.js';

export class MatchError extends Error { constructor(message: string) { super(`Match validation: ${message}`); } }
const requireProvider = (value: string): MetadataSource => { if (value !== 'tvdb' && value !== 'tmdb') throw new MatchError('provider must be tvdb or tmdb'); return value; };
// Token-set similarity uses normalized insertion/deletion distance, with no fuzzy dependency.
function ratio(a: string, b: string) {
  if (!a || !b) return 0;
  const previous = new Uint32Array(b.length + 1), current = new Uint32Array(b.length + 1);
  for (const x of a) { for (let j = 1; j <= b.length; j++) current[j] = x === b[j-1] ? previous[j-1]! + 1 : Math.max(previous[j]!, current[j-1]!); previous.set(current); }
  return 200 * previous[b.length]! / (a.length + b.length);
}
export function titleScore(a: string, b: string) {
  const tokens = (s: string) => new Set(s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean));
  const left = tokens(a), right = tokens(b), common = [...left].filter(t => right.has(t)).sort();
  const l = [...common, ...[...left].filter(t => !right.has(t)).sort()].join(' '), r = [...common, ...[...right].filter(t => !left.has(t)).sort()].join(' '), c = common.join(' ');
  return Math.max(ratio(l,r),ratio(c,l),ratio(c,r));
}
export function pickMatch(results: SearchResult[], title: string, year: number | null) {
  return results.filter(r => r.id && r.title).map(result => ({ result, score: titleScore(title,result.title) + (year !== null && result.year !== null ? year === result.year ? 15 : Math.abs(year-result.year) === 1 ? 5 : 0 : 0) })).sort((a,b) => b.score-a.score)[0];
}
export class Matcher {
  constructor(private db: Database.Database, private root: string, private settings: Settings, private providers: Record<MetadataSource, Pick<MetadataProvider,'search'>>) {}
  private async target(path: string) {
    const folder = await mediaPath(this.root,path), parts = relative(await mediaPath(this.root,'.'),folder).split(sep);
    if (parts.length !== 2 || !(await stat(folder)).isDirectory()) throw new MatchError('Expected an item folder immediately inside a library');
    const library = this.db.prepare('SELECT * FROM libraries WHERE name=?').get(parts[0]!) as Library | undefined;
    if (!library) throw new MatchError('Library not found; detect libraries first');
    await recoverSidecar(this.db,folder);
    return { folder, library, binding:getBinding(this.db,folder) };
  }
  private async persist(folder: string, binding: Binding | null, library: Library, rescan = true) {
    const before = folderSnapshot(this.db,folder), next = binding === null ? null : bindingSchema.parse(binding);
    // Write first: a failed sidecar write must never leave an unmirrored database binding.
    await writeSidecar(folder,{ ...before,binding:next });
    try { if (next) putBinding(this.db,folder,next); else this.db.prepare('DELETE FROM bindings WHERE folder_path=?').run(folder); }
    catch (error) { await writeSidecar(folder,before); throw error; }
    if (rescan) await scanLibrary(this.db,this.root,library.name);
  }
  async bind(input: BindRequest) {
    const provider = requireProvider(input.provider ?? 'tvdb'), target = await this.target(input.folder_path);
    const secondary = target.binding?.secondary_provider !== provider ? { secondary_provider:target.binding?.secondary_provider, secondary_external_id:target.binding?.secondary_external_id } : {};
    const binding = bindingSchema.parse({ ...secondary,kind:input.kind,provider,external_id:input.external_id,title:input.title ?? null,year:input.year ?? null,language:input.language ?? null,source_locked:input.lock_source ?? true });
    await this.persist(target.folder,binding,target.library); return { ok:true as const };
  }
  async source(input: SetSourceRequest) {
    const provider = requireProvider(input.provider), target = await this.target(input.folder_path), old = target.binding;
    const external_id = input.external_id || old?.external_id;
    if (!external_id) throw new MatchError('external_id required without an existing binding');
    const binding = bindingSchema.parse({ ...old,provider,external_id,kind:input.kind ?? old?.kind ?? 'series',title:input.title ?? old?.title ?? null,year:input.year ?? old?.year ?? null,source_locked:input.locked ?? true,
      ...(old?.secondary_provider === provider ? { secondary_provider:null,secondary_external_id:null } : {}) });
    await this.persist(target.folder,binding,target.library); return { ok:true as const };
  }
  async secondary(input: SetSecondaryRequest) {
    const target = await this.target(input.folder_path);
    if (!target.binding) throw new MatchError('A primary binding is required');
    const provider = input.provider ? requireProvider(input.provider) : null, external_id = input.external_id?.trim() || null;
    if (provider === target.binding.provider) throw new MatchError('Secondary provider must differ from primary');
    if (Boolean(provider) !== Boolean(external_id)) throw new MatchError('Secondary provider and external_id must both be set or cleared');
    await this.persist(target.folder,{ ...target.binding,secondary_provider:provider,secondary_external_id:external_id },target.library,false);
    return { ok:true as const,secondary_provider:provider,secondary_external_id:external_id };
  }
  async unbind(path: string) { const target = await this.target(path); await this.persist(target.folder,null,target.library); return { ok:true as const }; }
  async search(query: MatchSearchQuery): Promise<MatchSearchResponse> {
    const library = query.library ? this.db.prepare('SELECT * FROM libraries WHERE name=?').get(query.library) as Library | undefined : undefined;
    const provider = query.provider ? requireProvider(query.provider) : effectiveSource(null,library ?? null,this.settings.metadata_source);
    return { provider,results:await this.providers[provider].search(query.type ?? 'series',query.q,query.year,query.language ?? this.settings.preferred_language) };
  }
  async auto(path: string, options: { force?: boolean; language?: string; rescan?: boolean } = {}): Promise<AutoMatchResult> {
    const target = await this.target(path), { folder,library,binding } = target;
    if (binding?.source_locked) return { folder_path:folder,matched:false,reason:'locked' };
    if (binding && !options.force) return { folder_path:folder,matched:true,reason:'existing' };
    const parsed = parseFolder(basename(folder)), kind: ItemKind = binding?.kind ?? (library.kind === 'tv' ? 'series' : library.kind === 'movies' ? 'movie' : await detectKind(folder));
    const language = options.language ?? this.settings.preferred_language;
    const videos = kind === 'movie' ? (await readdir(folder,{withFileTypes:true})).filter(e => e.isFile() && videoPattern.test(e.name)).sort((a,b)=>a.name.localeCompare(b.name)).map(e=>parseMovie(e.name)) : [];
    const filenameId = videos.find(v => v.provider === 'tmdb' && v.external_id);
    let chosen: Binding, score: number | undefined;
    if (parsed.provider && parsed.external_id) chosen = bindingSchema.parse({ kind,provider:parsed.provider,external_id:parsed.external_id,title:parsed.title,year:parsed.year,language });
    else if (filenameId) chosen = bindingSchema.parse({ kind,provider:'tmdb',external_id:filenameId.external_id,title:filenameId.title,year:filenameId.year ?? parsed.year,language });
    else {
      const provider = effectiveSource(binding,library,this.settings.metadata_source), client = this.providers[provider];
      let best = pickMatch(await client.search(kind,parsed.title,parsed.year ?? undefined,language),parsed.title,parsed.year);
      if (parsed.year && (!best || best.score < this.settings.auto_match_threshold)) {
        const fallback = pickMatch(await client.search(kind,parsed.title,undefined,language),parsed.title,parsed.year);
        if (fallback && (!best || fallback.score > best.score)) best = fallback;
      }
      if (!best) return { folder_path:folder,matched:false,reason:'no_match' };
      score = Math.min(100,best.score);
      if (score < this.settings.auto_match_threshold) return { folder_path:folder,matched:false,reason:'low_confidence',score };
      chosen = bindingSchema.parse({ kind,provider,external_id:best.result.id,title:best.result.title,year:best.result.year ?? parsed.year,language });
    }
    if (filenameId && chosen.provider !== 'tmdb') chosen = { ...chosen,secondary_provider:'tmdb',secondary_external_id:filenameId.external_id };
    await this.persist(folder,chosen,library,options.rescan ?? true); return { folder_path:folder,matched:true,reason:'matched',...(score === undefined ? {} : {score}) };
  }
  async bulk(input: AutoBulkRequest): Promise<AutoBulkResponse> {
    if (!input.folder_paths?.length && !input.library) throw new MatchError('folder_paths or library is required');
    let paths = input.folder_paths ?? [];
    if (!paths.length && input.library) {
      await scanLibrary(this.db,this.root,input.library);
      paths = (this.db.prepare('SELECT folder_path FROM item_state WHERE library=? ORDER BY folder_path').all(input.library) as {folder_path:string}[]).map(r=>r.folder_path);
    }
    const results: AutoMatchResult[] = [];
    const changedLibraries = new Set<string>();
    for (const path of [...new Set(paths)]) {
      try {
        const { folder,binding,library } = await this.target(path);
        const state = this.db.prepare('SELECT last_built FROM item_state WHERE folder_path=?').get(folder) as {last_built:number|null} | undefined;
        if (input.only_unmatched && binding || input.only_unbuilt && state?.last_built) continue;
        const result = await this.auto(folder,{...input,rescan:false}); results.push(result);
        if (result.reason === 'matched') changedLibraries.add(library.name);
      } catch (error) { results.push({folder_path:path,matched:false,reason:'error',detail:error instanceof Error ? error.message : 'Match failed'}); }
    }
    for (const library of changedLibraries) await scanLibrary(this.db,this.root,library);
    return { ok:true,total:results.length,matched:results.filter(r=>r.matched).length,results };
  }
}
