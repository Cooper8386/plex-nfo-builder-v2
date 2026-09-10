import { test,expect } from 'vitest';
import { withSandbox } from '../../tests/support/sandbox.js';
import { writeTree } from '../../tests/support/media-tree.js';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { settingsSchema } from '../config/settings.js';
test('renamer routes reject disabled, unbound and invalid requests',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'TV/Show/S01E01.mkv':'video'});
  let enabled=false;const app=createApp({env:loadEnv({CONFIG_DIR:box.config,MEDIA_ROOT:box.media,API_TOKEN:'test'}),settings:()=>settingsSchema.parse({rename_enabled:enabled}),logger:false});
  try{await app.scanner.detect();for(const action of ['preview','apply']){
    const request={method:'POST' as const,url:'/api/episodes/rename/'+action,headers:{'x-api-token':'test'},payload:{folder_path:join(box.media,'TV/Show')}};
    expect((await app.inject(request)).statusCode).toBe(400);enabled=true;
    expect((await app.inject(request)).statusCode).toBe(400);
    expect((await app.inject({...request,payload:{...request.payload,series_type:'invalid'}})).statusCode).toBe(422);
  }}finally{await app.close();}
}));
