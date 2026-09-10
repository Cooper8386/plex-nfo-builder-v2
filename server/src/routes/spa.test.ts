import { join } from 'node:path';
import { symlink } from 'node:fs/promises';
import { expect,test } from 'vitest';
import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { withSandbox } from '../../tests/support/sandbox.js';
import { writeTree } from '../../tests/support/media-tree.js';

test('production SPA serves deep links and assets without exposing API misses or outside files',async()=>withSandbox(async box=>{
  const root=join(box.root,'static');
  await writeTree(root,{'index.html':'<!doctype html><div id="root"></div>','assets/app-12345678.js':'console.log("app")','assets/app-12345678.css':'body{color:red}'});
  await writeTree(box.config,{'secret.js':'private data'});
  await symlink(box.config,join(root,'assets/escape'),process.platform==='win32'?'junction':'dir');
  const app=createApp({env:loadEnv({API_TOKEN:'secret',CONFIG_DIR:box.config,MEDIA_ROOT:box.media}),spaRoot:root,logger:false});
  try{
    for(const url of ['/','/libraries/TV','/libraries/TV.English','/items/detail','/settings']){const r=await app.inject({url});expect(r.statusCode).toBe(200);expect(r.headers['content-type']).toContain('text/html');expect(r.headers['cache-control']).toBe('no-store');}
    const js=await app.inject({url:'/assets/app-12345678.js'});expect(js.statusCode).toBe(200);expect(js.headers['content-type']).toContain('text/javascript');expect(js.headers['x-content-type-options']).toBe('nosniff');
    expect((await app.inject({url:'/assets/app-12345678.css'})).headers['content-type']).toContain('text/css');
    for(const url of ['/assets/missing.js','/assets/escape/secret.js','/assets/%2e%2e%2findex.html','/server/package.json','/.env','/api/missing','/docs','/openapi.json']){const r=await app.inject({url,headers:{'x-api-token':'secret'}});expect(r.statusCode,url).toBe(404);expect(r.body).not.toContain('private data');}
    expect((await app.inject({url:'/api/missing'})).statusCode).toBe(401);
    expect((await app.inject({url:'/api/health',headers:{'x-api-token':'secret'}})).json().ok).toBe(true);
  }finally{await app.close();}
}));
