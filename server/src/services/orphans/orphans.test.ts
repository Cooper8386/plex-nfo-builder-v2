import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect,test } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { writeTree } from '../../../tests/support/media-tree.js';
import { previewOrphans, applyOrphans } from './orphans.js';
test('orphans preserve root-video show/season metadata and canonical art while deleting only captured orphan companions',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'a.S01E01.mkv':'video','a.S01E01.nfo':'keep','tvshow.nfo':'show','season.nfo':'season','poster.jpg':'poster','old.nfo':'old','old-thumb.png':'thumb','old.en.srt':'sub'});
  const plan=await previewOrphans(box.media);expect(plan.files.map(f=>f.path.split(/[\\/]/).pop()).sort()).toEqual(['old-thumb.png','old.nfo']);
  await writeTree(box.media,{'new.nfo':'new'});const result=await applyOrphans(plan,true);expect(result.removed).toHaveLength(2);
  expect(await readFile(join(box.media,'tvshow.nfo'),'utf8')).toBe('show');expect(await readFile(join(box.media,'new.nfo'),'utf8')).toBe('new');
}));
test('orphans recheck new videos before deleting an old candidate',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'release.nfo':'nfo','release-thumb.jpg':'image'});const plan=await previewOrphans(box.media);
  await writeTree(box.media,{'RELEASE.MKV':'arrived'});expect((await applyOrphans(plan,true)).removed).toEqual([]);
}));
