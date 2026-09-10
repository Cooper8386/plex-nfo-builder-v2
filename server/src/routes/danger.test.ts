import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect,test } from 'vitest';
import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { withSandbox } from '../../tests/support/sandbox.js';
import { writeTree } from '../../tests/support/media-tree.js';
test('cleaner library danger routes bind confirmation to a captured operation and never add new files',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'TV/Show/S01E01.mkv':'video','TV/Show/tvshow.nfo':'nfo','TV/Show/old.nfo':'old','TV/Show/.plex-nfo-builder.json':'sidecar'});
  const app=createApp({env:loadEnv({MEDIA_ROOT:box.media,CONFIG_DIR:box.config,API_TOKEN:'test'}),logger:false}),headers={'x-api-token':'test'};
  const post=(url:string,payload:object)=>app.inject({method:'POST',url,headers,payload});
  try {
    await app.scanner.detect();await app.scanner.scan('TV');
    expect((await post('/api/libraries/TV/wipe-nfo',{library:'TV'})).statusCode).toBe(400);
    expect((await post('/api/libraries/TV/wipe-nfo',{library:'Other',dry_run:true})).statusCode).toBe(400);
    for (const op of ['orphans/sweep','wipe-sidecars','wipe-nfo']) {
      const url='/api/libraries/TV/'+op;const preview=await post(url,{library:'TV',dry_run:true});expect(preview.statusCode,preview.body).toBe(200);
      expect((await post('/api/libraries/TV/wipe-nfo',{library:'TV',confirm:true,preview_id:preview.json().preview_id})).statusCode).toBe(op==='wipe-nfo'?200:400);
      if (op!=='wipe-nfo') expect((await post(url,{library:'TV',confirm:true,preview_id:preview.json().preview_id})).statusCode).toBe(200);
      expect((await post(url,{library:'TV',confirm:true,preview_id:preview.json().preview_id})).statusCode).toBe(400);
    }
    expect(await readFile(join(box.media,'TV/Show/S01E01.mkv'),'utf8')).toBe('video');
  }finally{await app.close();}
}));
