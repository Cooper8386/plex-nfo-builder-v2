import { join } from 'node:path';
import { expect,test } from 'vitest';
import { withSandbox } from '../../tests/support/sandbox.js';
import { writeTree } from '../../tests/support/media-tree.js';
import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';

test('builder routes validate targets and persist queued requests without runtime credentials',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'TV/Show/S01E01.mkv':''});
  const app=createApp({env:loadEnv({MEDIA_ROOT:box.media,CONFIG_DIR:box.config,API_TOKEN:'secret-test-token'}),logger:false});
  const headers={'x-api-token':'secret-test-token'},folder=join(box.media,'TV/Show');
  const post=(url:string,payload:object)=>app.inject({method:'POST',url,headers,payload});
  try {
    await app.scanner.detect();await app.scanner.scan('TV');
    expect((await post('/api/build',{})).statusCode).toBe(422);
    expect((await post('/api/build',{folder_path:folder})).statusCode).toBe(400);
    expect((await post('/api/build/bulk',{})).statusCode).toBe(400);
    expect((await post('/api/build',{folder_path:box.config})).statusCode).toBe(400);
    await app.matcher.bind({folder_path:folder,kind:'series',provider:'tmdb',external_id:'1'});
    const result=await post('/api/build',{folder_path:folder});expect(result.statusCode,result.body).toBe(200);
    await expect.poll(async()=>(await app.builder.queue.get(result.json().job))?.status).toBe('failed');
    const job=await app.builder.queue.get(result.json().job);
    expect(JSON.stringify(job)).not.toContain('secret-test-token');expect(JSON.stringify(job)).not.toContain('config_dir');
    expect(job?.messages[0]).toContain('not configured');
    expect((await app.inject({url:'/api/health',headers})).statusCode).toBe(200);
  } finally {await app.close();}
}));
