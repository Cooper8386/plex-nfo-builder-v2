import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { test,expect } from 'vitest';
import { withSandbox } from '../../tests/support/sandbox.js';
import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
test('watcher toggle persists opt-in settings but cannot override the environment kill switch',async()=>withSandbox(async box=>{
  const app=createApp({env:loadEnv({MEDIA_ROOT:box.media,CONFIG_DIR:box.config,API_TOKEN:'test',WATCHER_KILL_SWITCH:'true'}),logger:false}),headers={'x-api-token':'test'};
  try{
    const response=await app.inject({method:'POST',url:'/api/watcher/toggle',headers,payload:{enabled:true}});
    expect(response.statusCode,response.body).toBe(200);expect(response.json().status).toMatchObject({enabled:false,running:false});
    expect(JSON.parse(await readFile(join(box.config,'settings.json'),'utf8')).watcher_enabled).toBe(true);
    expect((await app.inject({url:'/api/watcher/events?limit=0',headers})).json()).toEqual({events:[]});
    expect((await app.inject({url:'/api/watcher/review',headers})).json()).toEqual({items:[]});
  }finally{await app.close();}
}));
