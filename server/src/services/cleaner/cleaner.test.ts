import { readFile, readdir, stat, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect,test } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { writeTree } from '../../../tests/support/media-tree.js';
import { previewClean, applyClean } from './cleaner.js';
test('cleaner revalidates a candidate replaced during the eligibility check',async()=>withSandbox(async box=>{
  const path=join(box.media,'old.nfo');await writeFile(path,'old');
  const plan=await previewClean(box.media);
  const result=await applyClean(plan,true,async()=>{
    await rename(path,join(box.media,'original.nfo'));await writeFile(path,'replacement');return true;
  });
  expect(result.removed).toEqual([]);expect(result.skipped[0]?.reason).toMatch(/replaced|changed/i);
  expect(await readFile(path,'utf8')).toBe('replacement');
}));
test('cleaner previews sidecars, removes actors and only captured generated files, preserving media',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'Show/Season 01/a.mkv':'video','Show/Season 01/a.en.srt':'sub','Show/Poster.JPG':'poster','Show/tvshow.nfo':'nfo','Show/.actors/Actor.jpg':'image','Show/.plex-nfo-builder.json':'sidecar'});
  const folder=join(box.media,'Show'),plan=await previewClean(folder,false);
  expect(plan.files.some(file=>file.path.endsWith('.plex-nfo-builder.json'))).toBe(true);
  await expect(applyClean(plan,false)).rejects.toThrow('confirmation');
  await writeTree(folder,{'new.nfo':'new'});
  const result=await applyClean(plan,true);expect(result.removed.sort()).toEqual(plan.files.map(file=>file.path).sort());
  expect(await readFile(join(folder,'new.nfo'),'utf8')).toBe('new');expect(await readFile(join(folder,'Season 01/a.mkv'),'utf8')).toBe('video');
  expect(await stat(join(folder,'Season 01')).then(s=>s.isDirectory())).toBe(true);expect(await readdir(folder)).not.toContain('.actors');
}));
test('cleaner defaults to retaining the recovery sidecar and unknown actor files',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'.plex-nfo-builder.json':'keep','.actors/portrait.jpg':'image','.actors/recording.mp3':'audio'});
  const plan=await previewClean(box.media);await applyClean(plan,true);
  expect(await readFile(join(box.media,'.plex-nfo-builder.json'),'utf8')).toBe('keep');expect(await readdir(join(box.media,'.actors'))).toEqual(['recording.mp3']);
}));
