import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { expect,test } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { writeTree } from '../../../tests/support/media-tree.js';
import { loadEnv } from '../../config/env.js';
import { settingsSchema } from '../../config/settings.js';
import { openDatabase } from '../../db/connection.js';
import { restoreSnapshot } from '../../db/queries.js';
import { sidecarSchema } from '../sidecar/format.js';
import { ScannerClient } from '../scanner/client.js';
import { MatcherClient } from '../matcher/client.js';
import { BuilderClient } from '../builder/client.js';
import { Watcher } from './watcher.js';
test('watcher regression: a new video queues a real build and review retry reruns matching',async()=>withSandbox(async box=>{
  const folder=join(box.media,'TV/Show'),unbound=join(box.media,'TV/New {tmdb-42}');await writeTree(box.media,{'TV/Show/seed.txt':'seed','TV/New {tmdb-42}/S01E01.mkv':'video'});
  const env=loadEnv({MEDIA_ROOT:box.media,CONFIG_DIR:box.config,WATCHER_ENABLED:'true'}),settings=()=>settingsSchema.parse({});
  const scanner=new ScannerClient(env,settings),matcher=new MatcherClient(env,settings),builder=new BuilderClient(env,settings);
  const watcher=new Watcher(env,settings,scanner,matcher,builder,{debounceMs:10,stableMs:20,pollMs:10});
  try{
    await scanner.detect();const db=await openDatabase(box.config);
    try{restoreSnapshot(db,folder,sidecarSchema.parse({version:2,binding:{kind:'series',provider:'tmdb',external_id:'1',source_locked:true}}));}finally{db.close();}
    await watcher.reload();await writeFile(join(folder,'S01E01.mkv'),'new video');
    await expect.poll(async()=>(await builder.queue.list()).some(job=>job.folder===folder),{timeout:10000}).toBe(true);
    await watcher.state.record({folder_path:unbound,library:'TV',kind:'series',reason:'no_match',detail:'earlier failure'});
    await watcher.retry(unbound);
    await expect.poll(async()=>(await builder.queue.list()).some(job=>job.folder===unbound),{timeout:10000}).toBe(true);
    await expect.poll(async()=>(await watcher.state.list()).length).toBe(0);
    await expect(watcher.retry(join(box.media,'TV'))).rejects.toThrow('Watcher validation');
    await expect(watcher.retry(join(box.media,'missing'))).rejects.toThrow('Watcher validation');
  }finally{await watcher.close();await builder.close();await matcher.close();await scanner.close();}
}),25000);
