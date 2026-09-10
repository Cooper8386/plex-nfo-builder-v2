import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { expect,test,vi } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { writeTree } from '../../../tests/support/media-tree.js';
import { loadEnv } from '../../config/env.js';
import { settingsSchema } from '../../config/settings.js';
import { ScannerClient } from '../scanner/client.js';
import { Watcher } from './watcher.js';
test('watcher debounces growth, records failed matches and honors the kill switch',async()=>withSandbox(async box=>{
  const folder=join(box.media,'TV/Show'),file=join(folder,'S01E01.mkv');await writeTree(box.media,{'TV/Show/S01E01.mkv':'1'});
  const env=loadEnv({MEDIA_ROOT:box.media,CONFIG_DIR:box.config}),settings=()=>settingsSchema.parse({}),scanner=new ScannerClient(env,settings);
  const bulk=vi.fn(async()=>({ok:true as const,total:1,matched:0,results:[{folder_path:folder,matched:false,reason:'low_confidence' as const}]})),build=vi.fn();
  const watcher=new Watcher(env,settings,scanner,{bulk},{build},{debounceMs:50,stableMs:40,pollMs:5});
  try{
    await scanner.detect();await watcher.reload();watcher.notify(file);
    await new Promise(r=>setTimeout(r,30));await writeFile(file,'longer');watcher.notify(file);
    expect(bulk).not.toHaveBeenCalled();
    await expect.poll(async()=>(await watcher.state.list()).length).toBe(1);expect(build).not.toHaveBeenCalled();
    expect((await watcher.state.list())[0]).toMatchObject({reason:'low_confidence',attempts:1});
    env.watcher_kill_switch=true;await watcher.reload();expect(watcher.status()).toMatchObject({enabled:false,running:false,pending_count:0});
    await expect(watcher.retry(folder)).rejects.toThrow('disabled');
  }finally{await watcher.close();await scanner.close();}
}));
test('watcher reload preserves a pending event for a library that remains enabled',async()=>withSandbox(async box=>{
  const folder=join(box.media,'TV/Show');await writeTree(box.media,{'TV/Show/S01E01.mkv':'1'});
  const env=loadEnv({MEDIA_ROOT:box.media,CONFIG_DIR:box.config}),settings=()=>settingsSchema.parse({}),scanner=new ScannerClient(env,settings);
  const bulk=vi.fn(async()=>({ok:true as const,total:1,matched:0,results:[{folder_path:folder,matched:false,reason:'no_match' as const}]}));
  const watcher=new Watcher(env,settings,scanner,{bulk},{build:vi.fn()},{debounceMs:80,stableMs:10,pollMs:5});
  try{await scanner.detect();await watcher.reload();watcher.notify(join(folder,'S01E01.mkv'));await watcher.reload();
    expect(watcher.status().pending_count).toBe(1);await expect.poll(()=>bulk.mock.calls.length).toBe(1);
  }finally{await watcher.close();await scanner.close();}
}));
test('watcher caps active pipelines and reload cancels pending build handoffs',async()=>withSandbox(async box=>{
  const env=loadEnv({MEDIA_ROOT:box.media,CONFIG_DIR:box.config,WATCHER_MAX_INFLIGHT:'2'});let enabled=true;
  const settings=()=>settingsSchema.parse({watcher_enabled:enabled}),scanner=new ScannerClient(env,settings);
  await writeTree(box.media,{'TV/One/S01E01.mkv':'1','TV/Two/S01E01.mkv':'2','TV/Three/S01E01.mkv':'3'});
  let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});let started=0,peak=0,active=0;
  const bulk=vi.fn(async(input:{folder_paths?:string[]})=>{started++;active++;peak=Math.max(peak,active);await gate;active--;return {ok:true as const,total:1,matched:1,results:[{folder_path:input.folder_paths![0]!,matched:true,reason:'matched' as const}]};});
  const build=vi.fn();const watcher=new Watcher(env,settings,scanner,{bulk},{build},{debounceMs:5,stableMs:5,pollMs:5});
  try{await scanner.detect();await watcher.reload();for(const name of ['One','Two','Three'])watcher.notify(join(box.media,'TV',name,'S01E01.mkv'));
    await expect.poll(()=>started).toBe(2);expect(peak).toBe(2);expect(watcher.events(0)).toEqual([]);
    enabled=false;await watcher.reload();release();await expect.poll(()=>watcher.status().in_flight_count).toBe(0);
    expect(build).not.toHaveBeenCalled();expect(started).toBe(2);expect(watcher.status().pending_count).toBe(0);
  }finally{release();await watcher.close();await scanner.close();}
}));
