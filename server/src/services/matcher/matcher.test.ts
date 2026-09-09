import { join } from 'node:path';
import { mkdir, rename } from 'node:fs/promises';
import { expect, test, vi } from 'vitest';
import type { SearchResult } from '../providers/normalized.js';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { writeTree } from '../../../tests/support/media-tree.js';
import { openDatabase } from '../../db/connection.js';
import { getBinding } from '../../db/queries.js';
import { settingsSchema } from '../../config/settings.js';
import { detectLibraries, scanLibrary } from '../scanner/scanner.js';
import { readSidecar, sidecarName } from '../sidecar/sidecar.js';
import { effectiveSource } from './effective-source.js';
import { Matcher, titleScore } from './matcher.js';
import { createApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';

const candidate = (title: string, year: number | null = null): SearchResult => ({provider:'tmdb',kind:'series',id:'100',title,year,plot:'',image:null});
test('matcher folder IDs bind without search, movie filename ID persists as TMDB identity, and bindings recover after DB wipe', async () => withSandbox(async box => {
  await writeTree(box.media,{'TV/Show {tvdb-1}/a.S01E01.mkv':'','TV/Other {tmdb-2}/a.S01E01.mkv':'','TV/Third {imdb-tt3}/a.S01E01.mkv':'','Movies/Film/Movie (2020) {tmdb-4}.mkv':'','Movies/Dual {tvdb-5}/Movie {tmdb-6}.mkv':''});
  let db = await openDatabase(box.config);
  const search = vi.fn(async (): Promise<SearchResult[]> => []);
  try {
    await detectLibraries(db,box.media);
    const matcher = new Matcher(db,box.media,settingsSchema.parse({}),{tvdb:{search},tmdb:{search}});
    const names = ['TV/Show {tvdb-1}','TV/Other {tmdb-2}','TV/Third {imdb-tt3}','Movies/Film','Movies/Dual {tvdb-5}'];
    for (const name of names) expect((await matcher.auto(join(box.media,name))).matched).toBe(true);
    expect(search).not.toHaveBeenCalled();
    expect(getBinding(db,join(box.media,'Movies/Film'))).toMatchObject({provider:'tmdb',external_id:'4',year:2020});
    const dual = join(box.media,'Movies/Dual {tvdb-5}');
    expect(getBinding(db,dual)).toMatchObject({provider:'tvdb',external_id:'5',secondary_provider:'tmdb',secondary_external_id:'6'});
    const before = await readSidecar(dual); db.close(); db = await openDatabase(join(box.config,'fresh'));
    await detectLibraries(db,box.media); await scanLibrary(db,box.media,'Movies');
    expect(getBinding(db,dual)).toEqual(before?.binding);
  } finally { db.close(); }
}));

test('matcher rejects low confidence, retries year filter, and resolves binding/library/global providers', async () => withSandbox(async box => {
  await writeTree(box.media,{'TV/Wanted Show (2020)/a.S01E01.mkv':'','TV/Unrelated Show/a.S01E01.mkv':''});
  const db = await openDatabase(box.config), search = vi.fn(async (_kind: string,title: string,year?: number) => title === 'Wanted Show' && year === undefined ? [candidate('Wanted Show',2021)] : [candidate('Banana Planet')]);
  const tvdbSearch = vi.fn(async ():Promise<SearchResult[]>=>[]);
  try {
    await detectLibraries(db,box.media); db.prepare("UPDATE libraries SET metadata_source='tmdb'").run();
    const matcher = new Matcher(db,box.media,settingsSchema.parse({}),{tvdb:{search:tvdbSearch},tmdb:{search}});
    expect((await matcher.auto(join(box.media,'TV/Wanted Show (2020)'))).matched).toBe(true);
    expect(search.mock.calls.map(c=>c[2])).toEqual([2020,undefined]);
    expect((await matcher.auto(join(box.media,'TV/Unrelated Show'))).reason).toBe('low_confidence');
    expect(getBinding(db,join(box.media,'TV/Unrelated Show'))).toBeNull(); expect(tvdbSearch).not.toHaveBeenCalled();
    expect(effectiveSource({provider:'tvdb'},{metadata_source:'tmdb'},'tmdb')).toBe('tvdb');
    expect(effectiveSource(null,{metadata_source:'tmdb'},'tvdb')).toBe('tmdb');
    expect(effectiveSource(null,null,'tvdb')).toBe('tvdb');
    expect(titleScore('The Show','Show The')).toBe(100);
  } finally { db.close(); }
}));

test('matcher manual mutations mirror sidecars, locks resist forced bulk and failed writes preserve the database', async () => withSandbox(async box => {
  await writeTree(box.media,{'TV/Show/a.S01E01.mkv':''}); const folder = join(box.media,'TV/Show');
  const db = await openDatabase(box.config), search = vi.fn(async()=>[candidate('Show')]);
  try {
    await detectLibraries(db,box.media);
    const matcher = new Matcher(db,box.media,settingsSchema.parse({}),{tvdb:{search},tmdb:{search}});
    await matcher.bind({folder_path:folder,kind:'series',provider:'tvdb',external_id:'1',title:'Manual'});
    expect((await matcher.bulk({folder_paths:[folder],force:true})).results[0]?.reason).toBe('locked'); expect(search).not.toHaveBeenCalled();
    await matcher.secondary({folder_path:folder,provider:'tmdb',external_id:'2'});
    expect((await readSidecar(folder))?.binding).toEqual(getBinding(db,folder));
    await expect(matcher.secondary({folder_path:folder,provider:'tvdb',external_id:'3'})).rejects.toThrow('differ');
    await matcher.source({folder_path:folder,provider:'tmdb',external_id:'2'});
    expect(getBinding(db,folder)).toMatchObject({provider:'tmdb',source_locked:true,secondary_provider:null});
    expect((await readSidecar(folder))?.binding).toEqual(getBinding(db,folder));
    await matcher.source({folder_path:folder,provider:'tmdb',locked:false});
    expect(getBinding(db,folder)?.source_locked).toBe(false);
    await matcher.unbind(folder); expect(getBinding(db,folder)).toBeNull(); expect((await readSidecar(folder))?.binding).toBeNull();
    await scanLibrary(db,box.media,'TV'); expect(getBinding(db,folder)).toBeNull();
    await matcher.bind({folder_path:folder,kind:'series',external_id:'1'});
    const before = getBinding(db,folder);
    await rename(join(folder,sidecarName),join(folder,'saved-sidecar.json')); await mkdir(join(folder,sidecarName));
    await expect(matcher.source({folder_path:folder,provider:'tmdb',external_id:'9'})).rejects.toThrow();
    expect(getBinding(db,folder)).toEqual(before);
  } finally { db.close(); }
}));

test('matcher routes validate requests, persist serial writes, and expose the refreshed item', async () => withSandbox(async box => {
  await writeTree(box.media,{'TV/Show/a.S01E01.mkv':''}); const folder = join(box.media,'TV/Show');
  const app = createApp({logger:false,env:loadEnv({API_TOKEN:'test',CONFIG_DIR:box.config,MEDIA_ROOT:box.media})}), headers = {'x-api-token':'test'};
  try {
    await app.scanner.detect();
    const post = (url:string,payload:object)=>app.inject({method:'POST',url,headers,payload});
    expect((await post('/api/match/bind',{folder_path:folder,kind:'series',provider:'invalid',external_id:'1'})).statusCode).toBe(400);
    expect((await post('/api/match/bind',{folder_path:folder})).statusCode).toBe(422);
    expect((await post('/api/match/auto-bulk',{})).statusCode).toBe(400);
    expect((await post('/api/match/bind',{folder_path:folder,kind:'series',provider:'tvdb',external_id:'1',title:'Bound'})).statusCode).toBe(200);
    const responses = await Promise.all([post('/api/match/secondary',{folder_path:folder,provider:'tmdb',external_id:'2'}),post('/api/match/source',{folder_path:folder,provider:'tvdb',locked:false})]);
    expect(responses.map(r=>r.statusCode)).toEqual([200,200]);
    expect((await readSidecar(folder))?.binding).toMatchObject({secondary_external_id:'2',source_locked:false});
    expect((await app.scanner.items())[0]?.title).toBe('Bound');
    expect((await app.inject({url:'/api/match/search?q=Show&provider=invalid',headers})).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:`/api/match/unbind?folder_path=${encodeURIComponent(folder)}`,headers})).statusCode).toBe(200);
    expect((await readSidecar(folder))?.binding).toBeNull();
  } finally { await app.close(); }
}));
