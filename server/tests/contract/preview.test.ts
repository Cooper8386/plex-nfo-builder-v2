import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { test, expect, vi } from 'vitest';
import type { RecordPreview, RenamePreview, RenameResult } from 'shared';
import { withSandbox } from '../support/sandbox.js';
import { writeTree } from '../support/media-tree.js';
import { openDatabase } from '../../src/db/connection.js';
import { putBinding } from '../../src/db/queries.js';
import { settingsSchema } from '../../src/config/settings.js';
import { loadEnv } from '../../src/config/env.js';
import { createApp } from '../../src/app.js';
import { detectLibraries } from '../../src/services/scanner/scanner.js';
import { renameRequest } from '../../src/services/renamer/request.js';
import { capturePreview, consumePreview } from '../../src/services/cleaner/previews.js';
import type { Providers } from '../../src/services/providers/providers.js';
import type { Metadata } from '../../src/services/providers/normalized.js';
import { bindingSchema } from '../../src/services/sidecar/format.js';

const metadata:Metadata={provider:'tmdb',kind:'series',id:'1',title:'Original',year:2020,plot:'',image:null,original_title:'',sort_title:'',tagline:'',runtime:null,aired:null,genres:[],studios:[],rating:null,content_rating:'',status:'',ids:{tmdb:'1'},cast:[],episodes:[],seasons:[],artwork:[]};
test('preview rename holds destinations and companions fixed, excludes arrivals and requires confirmation',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'TV/Show/S01E01.mkv':'video','TV/Show/S01E01.nfo':'nfo'});
  const folder=join(box.media,'TV/Show'),db=await openDatabase(box.config),data=structuredClone(metadata),details=vi.fn(async()=>data),providers={details} as unknown as Providers,settings=settingsSchema.parse({});
  try{
    await detectLibraries(db,box.media);putBinding(db,folder,bindingSchema.parse({provider:'tmdb',external_id:'1',kind:'series',source_locked:true}));
    const preview=await renameRequest(db,box.media,settings,providers,{folder_path:folder,template:'{Series Title} S{season:00}E{episode:00}'}) as RenamePreview;
    expect(preview.preview_id).toBeTruthy();expect(preview.items[0]?.companions).toHaveLength(1);
    const input={folder_path:folder,preview_id:preview.preview_id,only_src:[preview.items[0]!.src]};
    await expect(renameRequest(db,box.media,settings,providers,input,true)).rejects.toThrow(/Confirmation/);
    data.title='Changed';await writeTree(folder,{'S01E01.en.srt':'arriving subtitle','S01E02.mkv':'arriving video'});
    const result=await renameRequest(db,box.media,settings,providers,{...input,confirm:true},true) as RenameResult;
    expect(result.renamed).toHaveLength(1);expect(result.companions_moved).toHaveLength(1);expect(details).toHaveBeenCalledOnce();
    expect(await readFile(preview.items[0]!.dst,'utf8')).toBe('video');
    expect(await readFile(join(folder,'S01E01.en.srt'),'utf8')).toBe('arriving subtitle');expect(await readFile(join(folder,'S01E02.mkv'),'utf8')).toBe('arriving video');
    await expect(renameRequest(db,box.media,settings,providers,{...input,confirm:true},true)).rejects.toThrow(/current preview/);
  }finally{db.close();}
}));
test('preview rename preserves changed files and conflicting destinations while unaffected groups finish',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'TV/Show/S01E01.mkv':'one','TV/Show/S01E02.mkv':'two','TV/Show/S01E03.mkv':'three'});
  const folder=join(box.media,'TV/Show'),db=await openDatabase(box.config),providers={details:async()=>metadata} as unknown as Providers,settings=settingsSchema.parse({});
  try{
    await detectLibraries(db,box.media);putBinding(db,folder,bindingSchema.parse({provider:'tmdb',external_id:'1',kind:'series',source_locked:true}));
    const preview=await renameRequest(db,box.media,settings,providers,{folder_path:folder,template:'new-{episode}'}) as RenamePreview;
    await writeFile(preview.items[1]!.src,'replacement');await writeFile(preview.items[2]!.dst,'occupied');
    const result=await renameRequest(db,box.media,settings,providers,{folder_path:folder,preview_id:preview.preview_id,confirm:true,only_src:preview.items.map(item=>item.src)},true) as RenameResult;
    expect(result.renamed).toHaveLength(1);expect(result.failed).toHaveLength(2);
    expect(await readFile(preview.items[1]!.src,'utf8')).toBe('replacement');expect(await readFile(preview.items[2]!.dst,'utf8')).toBe('occupied');
  }finally{db.close();}
}));
test('preview token rejects a different operation, expires and is single-use',()=>{
  const id=capturePreview('one',[1]);expect(()=>consumePreview('two',id,true)).toThrow(/current preview/);
  expect(consumePreview('one',id,true)).toEqual([1]);expect(()=>consumePreview('one',id,true)).toThrow();
  const expired=capturePreview('one',[]),now=Date.now();const clock=vi.spyOn(Date,'now').mockReturnValue(now+31*60_000);
  try{expect(()=>consumePreview('one',expired,true)).toThrow(/current preview/);}finally{clock.mockRestore();}
});
test('preview custom deletion captures references and upload identity and rejects drift',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'TV/Show/S01E01.mkv':'video'});
  const folder=join(box.media,'TV/Show'),app=createApp({env:loadEnv({MEDIA_ROOT:box.media,CONFIG_DIR:box.config,API_TOKEN:'test'}),logger:false}),headers={'x-api-token':'test'};
  const post=(url:string,payload:object)=>app.inject({method:'POST',url,headers,payload});
  try{
    const asset=await app.matcher.artwork<{id:string;url:string;file_path:string}>({op:'register',folder_path:folder,slot:'poster',content_type:'image/png',data:Buffer.from('original').toString('base64')});
    const select=(slot:string)=>post('/api/artwork/select',{folder_path:folder,slot,url:asset.url});
    await select('season-01-poster');
    expect((await app.inject({method:'DELETE',url:asset.url,headers})).statusCode).toBe(400);
    const request={op:'custom-delete',id:asset.id};
    const first=(await post('/api/previews',{...request,dry_run:true})).json<RecordPreview>();expect(first.targets.some(target=>target.includes('season-01-poster'))).toBe(true);
    await select('season-02-poster');expect((await post('/api/previews',{...request,confirm:true,preview_id:first.preview_id})).statusCode).toBe(400);
    expect(await readFile(asset.file_path,'utf8')).toBe('original');
    const second=(await post('/api/previews',{...request,dry_run:true})).json<RecordPreview>();await writeFile(asset.file_path,'replacement');
    expect((await post('/api/previews',{...request,confirm:true,preview_id:second.preview_id})).statusCode).toBe(400);
    const third=(await post('/api/previews',{...request,dry_run:true})).json<RecordPreview>();
    expect((await post('/api/previews',{...request,confirm:true,preview_id:third.preview_id})).json()).toEqual({ok:true,removed:3,skipped:0});
    expect((await app.inject({url:asset.url,headers})).statusCode).toBe(404);
  }finally{await app.close();}
}));
test('preview bulk reset and review clearing preserve added or changed records',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'TV/Show/S01E01.mkv':'video'});
  const folder=join(box.media,'TV/Show'),app=createApp({env:loadEnv({MEDIA_ROOT:box.media,CONFIG_DIR:box.config,API_TOKEN:'test'}),logger:false}),headers={'x-api-token':'test'};
  const post=(url:string,payload:object)=>app.inject({method:'POST',url,headers,payload});
  try{
    await app.scanner.detect();
    await post('/api/overrides',{folder_path:folder,scope:'series',field:'title',value:'First'});
    const request={op:'overrides-clear',folder_path:folder},preview=(await post('/api/previews',{...request,dry_run:true})).json<RecordPreview>();
    await post('/api/overrides',{folder_path:folder,scope:'series',field:'plot',value:'New plot'});
    expect((await post('/api/previews',{...request,preview_id:preview.preview_id,confirm:true})).json()).toEqual({ok:true,removed:1,skipped:0});
    expect((await app.matcher.overrides(folder)).overrides).toEqual([{scope:'series',field:'plot',value:'New plot'}]);
    await post('/api/overrides',{folder_path:folder,scope:'series',field:'title',value:'Keep this title'});
    const fieldRequest={folder_path:folder,field:'plot'},fieldPreview=(await post('/api/overrides/clear',{...fieldRequest,dry_run:true})).json<RecordPreview>();
    expect(fieldPreview.targets).toHaveLength(1);
    expect((await post('/api/overrides/clear',{...fieldRequest,preview_id:fieldPreview.preview_id,confirm:true})).json()).toEqual({ok:true,removed:1,skipped:0});
    expect((await app.matcher.overrides(folder)).overrides).toEqual([{scope:'series',field:'title',value:'Keep this title'}]);
    for(const payload of [{op:'library-delete'},{op:'custom-delete'},{op:'overrides-clear',folder_path:folder,scope:'invalid'},{op:'overrides-clear',folder_path:folder,field:'invalid'}])expect((await post('/api/previews',{...payload,dry_run:true})).statusCode).toBe(400);
    await app.watcher.state.record({folder_path:folder,library:'TV',kind:'series',reason:'error',detail:'old'});
    const review=(await post('/api/previews',{op:'review-clear',dry_run:true})).json<RecordPreview>();
    await app.watcher.state.record({folder_path:join(box.media,'TV/New'),library:'TV',kind:'series',reason:'error',detail:'new'});
    await post('/api/previews',{op:'review-clear',preview_id:review.preview_id,confirm:true});
    expect((await app.watcher.state.list()).map(row=>row.detail)).toEqual(['new']);
    const changing=(await post('/api/previews',{op:'review-clear',dry_run:true})).json<RecordPreview>();
    await app.watcher.state.record({folder_path:join(box.media,'TV/New'),library:'TV',kind:'series',reason:'error',detail:'changed'});
    expect((await post('/api/previews',{op:'review-clear',preview_id:changing.preview_id,confirm:true})).json()).toEqual({ok:true,removed:0,skipped:1});
  }finally{await app.close();}
}));
test('preview library removal rejects newly discovered items and keeps media',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'TV/Show/S01E01.mkv':'video'});
  const app=createApp({env:loadEnv({MEDIA_ROOT:box.media,CONFIG_DIR:box.config,API_TOKEN:'test'}),logger:false}),headers={'x-api-token':'test'},request={op:'library-delete',library:'TV'};
  const post=(payload:object)=>app.inject({method:'POST',url:'/api/previews',headers,payload});
  try{
    await app.scanner.detect();await app.scanner.scan('TV');
    const preview=(await post({...request,dry_run:true})).json<RecordPreview>();
    await writeTree(box.media,{'TV/New/S01E01.mkv':'arrival'});await app.scanner.scan('TV');
    expect((await post({...request,preview_id:preview.preview_id,confirm:true})).statusCode).toBe(400);
    expect(await app.scanner.items()).toHaveLength(2);
    const next=(await post({...request,dry_run:true})).json<RecordPreview>();
    expect((await post({...request,preview_id:next.preview_id,confirm:true})).json()).toMatchObject({ok:true});
    expect(await app.scanner.libraries()).toHaveLength(0);expect(await readFile(join(box.media,'TV/New/S01E01.mkv'),'utf8')).toBe('arrival');
  }finally{await app.close();}
}));
