import { readFile,readdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test,expect } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { writeTree } from '../../../tests/support/media-tree.js';
import { openDatabase } from '../../db/connection.js';
import { folderSnapshot,restoreSnapshot } from '../../db/queries.js';
import { settingsSchema } from '../../config/settings.js';
import { parseProbe } from '../mediainfo/mediainfo.js';
import { sidecarSchema } from '../sidecar/format.js';
import { readSidecar } from '../sidecar/sidecar.js';
import { previewRename,applyRename } from './renamer.js';
import type { Metadata } from '../providers/normalized.js';
const data:Metadata={provider:'tmdb',kind:'series',id:'1',title:'The Show',year:2020,plot:'',image:null,original_title:'',sort_title:'',tagline:'',runtime:null,aired:null,genres:[],studios:[],rating:null,content_rating:'',status:'',ids:{tmdb:'1'},cast:[],episodes:[{id:'e1',season:1,episode:1,title:'Pilot',aired:'2020-01-01',plot:'',runtime:null,image:null}],seasons:[],artwork:[]};
const settings=settingsSchema.parse({});
const probe=async(path:string)=>parseProbe({},path);
test('renamer moves checked video, all companions and saved mapping together',async()=>withSandbox(async box=>{
  const folder=join(box.media,'TV/Show');await writeTree(folder,{'S01E01.mkv':'video','S01E01.nfo':'nfo','S01E01-thumb.png':'image','S01E01.en.forced.srt':'sub','S01E01.sup':'sub','S01E01.notes.txt':'notes','S01E02.mkv':'other'});
  const db=await openDatabase(box.config);
  try {
    restoreSnapshot(db,folder,sidecarSchema.parse({version:2,binding:null,episode_file_overrides:[{file_path:'S01E01.mkv',season:1,episode:1,external_id:'e1'}]}));
    const plan=await previewRename(folder,data,folderSnapshot(db,folder),settings,{folder_path:folder,template:'{Series TitleThe} - S{season:00}E{episode:00}'},probe);
    expect(plan.items[0]?.dst_name).toBe('Show, The - S01E01.mkv');expect(await readdir(folder)).toContain('S01E01.mkv');
    const result=await applyRename(db,folder,plan.items,[join(folder,'S01E01.mkv')]);expect(result.renamed).toHaveLength(1);
    for(const suffix of ['.mkv','.nfo','-thumb.png','.en.forced.srt','.sup'])expect(await readFile(join(folder,'Show, The - S01E01'+suffix),'utf8')).toBeTruthy();
    expect(await readdir(folder)).toContain('S01E01.notes.txt');expect(await readdir(folder)).toContain('S01E02.mkv');
    expect(folderSnapshot(db,folder).episode_file_overrides[0]?.file_path).toBe('Show, The - S01E01.mkv');
    expect((await readSidecar(folder))?.episode_file_overrides).toEqual(folderSnapshot(db,folder).episode_file_overrides);
  }finally{db.close();}
}));
test('renamer handles case-only changes and refuses cross-folder or occupied destinations',async()=>withSandbox(async box=>{
  const folder=join(box.media,'TV/Show');await writeTree(folder,{'S01E01.mkv':'video','S01E01.nfo':'nfo'});const db=await openDatabase(box.config);
  try {
    const plan=await previewRename(folder,data,folderSnapshot(db,folder),settings,{folder_path:folder,template:'s01e01'},probe);
    expect(plan.items[0]).toMatchObject({conflict:null,unchanged:false});expect((await applyRename(db,folder,plan.items)).renamed).toHaveLength(1);
    expect(await readdir(folder)).toContain('s01e01.mkv');expect(await readdir(folder)).toContain('s01e01.nfo');
    const item=plan.items[0]!;item.src=join(folder,'s01e01.mkv');item.dst=join(box.media,'escape.mkv');
    expect((await applyRename(db,folder,[item])).failed[0]?.reason).toMatch(/cross-folder/i);
    item.dst=join(folder,'occupied.mkv');await writeFile(item.dst,'keep');expect((await applyRename(db,folder,[item])).failed).toHaveLength(1);expect(await readFile(item.dst,'utf8')).toBe('keep');
  }finally{db.close();}
}));
test('renamer auto selects templates per filename, not provider air date; release override wins',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'S01E01.mkv':'a','Daily.2020-01-01.mkv':'b','[Group] Show - 01.mkv':'c'});
  const plan=await previewRename(box.media,data,sidecarSchema.parse({version:2,binding:null}),settings,{folder_path:box.media,template:'standard',daily_template:'daily',anime_template:'anime{-Release Group}',release_group:'Mine'},probe);
  expect(plan.items.map(i=>i.dst_name).sort()).toEqual(['anime-Mine.mkv','daily.mkv','standard.mkv']);
}));
test('renamer marks duplicate targets, respects no checked rows and protects occupied companions',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'a.mkv':'a','b.mp4':'b','target.nfo':'keep'});const db=await openDatabase(box.config);
  try{
    const movie={...data,kind:'movie' as const};
    const plan=await previewRename(box.media,movie,folderSnapshot(db,box.media),settings,{folder_path:box.media,template:'target'},probe);
    expect((await applyRename(db,box.media,plan.items,[])).renamed).toEqual([]);
    await writeFile(join(box.media,'a.nfo'),'source');
    expect((await applyRename(db,box.media,plan.items,[join(box.media,'a.mkv')])).failed).toHaveLength(1);
    expect(await readFile(join(box.media,'a.mkv'),'utf8')).toBe('a');expect(await readFile(join(box.media,'target.nfo'),'utf8')).toBe('keep');
    await writeFile(join(box.media,'c.mkv'),'c');
    const duplicate=await previewRename(box.media,movie,folderSnapshot(db,box.media),settings,{folder_path:box.media,template:'target'},probe);
    expect(duplicate.items.filter(i=>i.dst.endsWith('.mkv')).every(i=>i.conflict==='duplicate')).toBe(true);
  }finally{db.close();}
}));
test('renamer leaves a longer video stem and its subtitle together',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'S01E01.mkv':'one','S01E01.en.srt':'one sub','S01E01.OtherRelease.mkv':'two','S01E01.OtherRelease.en.srt':'two sub'});
  const db=await openDatabase(box.config);
  try{const plan=await previewRename(box.media,data,folderSnapshot(db,box.media),settings,{folder_path:box.media,template:'target'},probe);
    const item=plan.items.find(i=>i.src_name==='S01E01.mkv')!;item.conflict=null;
    expect((await applyRename(db,box.media,[item])).renamed).toHaveLength(1);
    expect(await readFile(join(box.media,'S01E01.OtherRelease.en.srt'),'utf8')).toBe('two sub');expect(await readFile(join(box.media,'target.en.srt'),'utf8')).toBe('one sub');
  }finally{db.close();}
}));
