import { join } from 'node:path';
import { expect,test } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { writeTree } from '../../../tests/support/media-tree.js';
import { createApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';
import { readSidecar } from '../sidecar/sidecar.js';
test('nfo override routes persist scopes, restore fallback and update sort title',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'TV/The Show/a.S01E01.mkv':''});const folder=join(box.media,'TV/The Show');
  const app=createApp({logger:false,env:loadEnv({API_TOKEN:'test',CONFIG_DIR:box.config,MEDIA_ROOT:box.media})}),headers={'x-api-token':'test'};
  try{
    await app.scanner.detect();await app.scanner.scan('TV');
    const post=(path:string,payload:object)=>app.inject({method:'POST',url:path,headers,payload});
    expect((await post('/api/overrides',{folder_path:folder,scope:'series',field:'sorttitle',value:'First'})).statusCode).toBe(200);
    expect((await app.scanner.items())[0]?.sort_title).toBe('First');
    expect((await readSidecar(folder))?.overrides[0]?.value).toBe('First');
    expect((await post('/api/overrides',{folder_path:folder,scope:'series',field:'sorttitle',value:''})).statusCode).toBe(200);
    expect((await app.scanner.items())[0]?.sort_title).toBe('Show');
    expect((await post('/api/overrides',{folder_path:folder,scope:'bad',field:'title',value:'Bad'})).statusCode).toBe(400);
    await post('/api/overrides',{folder_path:folder,scope:'episode-4',field:'title',value:'Episode'});
    await post('/api/overrides/clear',{folder_path:folder});
    expect((await app.inject({url:`/api/overrides?path=${encodeURIComponent(folder)}`,headers})).json().overrides).toEqual([]);
    expect((await readSidecar(folder))?.overrides).toEqual([]);
  }finally{await app.close();}
}));
