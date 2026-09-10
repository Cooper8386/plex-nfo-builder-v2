import { join } from 'node:path';
import { mkdir, readFile, rmdir, symlink } from 'node:fs/promises';
import { expect,test } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { writeTree } from '../../../tests/support/media-tree.js';
import { openDatabase } from '../../db/connection.js';
import { detectLibraries,scanLibrary } from '../scanner/scanner.js';
import { previewPrune,applyPrune } from './prune.js';
test('prune empty rechecks arrivals, keeps media and only forgets captured empty folders',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'TV/Empty/tvshow.nfo':'nfo','TV/Arriving/placeholder.txt':'keep'});const db=await openDatabase(box.config);
  try {await detectLibraries(db,box.media);await scanLibrary(db,box.media,'TV');const plan=await previewPrune(db,box.media,{library:'TV',empty:true,deleteFiles:true});
    await writeTree(box.media,{'TV/Arriving/new.mkv':'new','TV/New/placeholder.txt':'new'});await scanLibrary(db,box.media,'TV');
    const result=await applyPrune(db,plan,true);expect(result.removed).toEqual([join(box.media,'TV/Empty')]);
    expect(db.prepare('SELECT folder_path FROM item_state').all()).toHaveLength(2);expect(await readFile(join(box.media,'TV/Arriving/new.mkv'),'utf8')).toBe('new');
  }finally{db.close();}
}));
test('prune missing removes database rows only for captured absent folders',async()=>withSandbox(async box=>{
  const folder=join(box.media,'TV/Missing');await mkdir(folder,{recursive:true});const db=await openDatabase(box.config);
  try {await detectLibraries(db,box.media);await scanLibrary(db,box.media,'TV');await rmdir(folder);
    const plan=await previewPrune(db,box.media,{library:'TV'});expect(plan.folders.map(entry=>entry.folder)).toEqual([folder]);expect(plan.deleteFiles).toBe(false);
    expect((await applyPrune(db,plan,true)).removed).toEqual([folder]);expect(db.prepare('SELECT * FROM item_state').all()).toEqual([]);
  }finally{db.close();}
}));
test('prune missing preserves a folder that reappears after preview',async()=>withSandbox(async box=>{
  const folder=join(box.media,'TV/Returning');await mkdir(folder,{recursive:true});const db=await openDatabase(box.config);
  try {await detectLibraries(db,box.media);await scanLibrary(db,box.media,'TV');await rmdir(folder);
    const plan=await previewPrune(db,box.media,{});await writeTree(box.media,{'TV/Returning/new.mkv':'new video'});
    const result=await applyPrune(db,plan,true);expect(result.removed).toEqual([]);expect(result.skipped).toHaveLength(1);
    expect(db.prepare('SELECT * FROM item_state').all()).toHaveLength(1);expect(await readFile(join(folder,'new.mkv'),'utf8')).toBe('new video');
  }finally{db.close();}
}));
test('prune requires explicit confirmation before forgetting empty folders',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'TV/Empty/tvshow.nfo':'keep until confirmation'});const db=await openDatabase(box.config);
  try {await detectLibraries(db,box.media);await scanLibrary(db,box.media,'TV');const plan=await previewPrune(db,box.media,{empty:true,deleteFiles:true});
    await expect(applyPrune(db,plan,false)).rejects.toThrow(/confirm/i);expect(db.prepare('SELECT * FROM item_state').all()).toHaveLength(1);
    expect(await readFile(join(box.media,'TV/Empty/tvshow.nfo'),'utf8')).toBe('keep until confirmation');
  }finally{db.close();}
}));
test('prune empty defaults to database-only changes and protects nested video and unknown links',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'TV/Empty/tvshow.nfo':'retained','TV/Nested/Extras/clip.mkv':'video','TV/Linked/placeholder.txt':'keep'});
  await symlink(box.config,join(box.media,'TV/Linked/unknown'),process.platform==='win32'?'junction':'dir');const db=await openDatabase(box.config);
  try {await detectLibraries(db,box.media);await scanLibrary(db,box.media,'TV');const plan=await previewPrune(db,box.media,{empty:true});
    expect(plan.folders.map(entry=>entry.folder)).toEqual([join(box.media,'TV/Empty')]);await applyPrune(db,plan,true);
    expect(await readFile(join(box.media,'TV/Empty/tvshow.nfo'),'utf8')).toBe('retained');expect(db.prepare('SELECT * FROM item_state').all()).toHaveLength(2);
  }finally{db.close();}
}));
test('prune missing checks the canonical parent when a missing path crosses a new junction',async()=>withSandbox(async box=>{
  const folder=join(box.media,'TV/Missing');await mkdir(folder,{recursive:true});const db=await openDatabase(box.config);
  try {await detectLibraries(db,box.media);await scanLibrary(db,box.media,'TV');await rmdir(folder);await rmdir(join(box.media,'TV'));
    await symlink(box.config,join(box.media,'TV'),process.platform==='win32'?'junction':'dir');
    expect((await previewPrune(db,box.media,{})).folders).toEqual([]);expect(db.prepare('SELECT * FROM item_state').all()).toHaveLength(1);
  }finally{db.close();}
}));
