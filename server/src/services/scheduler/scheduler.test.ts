import { join } from 'node:path';
import { expect,test,vi } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { writeTree } from '../../../tests/support/media-tree.js';
import { loadEnv } from '../../config/env.js';
import { settingsSchema } from '../../config/settings.js';
import { openDatabase } from '../../db/connection.js';
import { detectLibraries,scanLibrary } from '../scanner/scanner.js';
import { getBinding } from '../../db/queries.js';
import { BuilderClient } from '../builder/client.js';
import { workerModule } from '../fs/off-loop.js';
import { Scheduler } from './scheduler.js';
test('scheduler executes every action through the queue, supports all-library update, and avoids duplicate runs',async()=>withSandbox(async box=>{
  const folder=join(box.media,'TV/Show {tmdb-42}');await writeTree(box.media,{'TV/Show {tmdb-42}/S01E01.mkv':'video'});
  const env=loadEnv({MEDIA_ROOT:box.media,CONFIG_DIR:box.config}),settings=()=>settingsSchema.parse({fanart_enabled:false});
  const db=await openDatabase(box.config);await detectLibraries(db,box.media);await scanLibrary(db,box.media,'TV');
  const builder=new BuilderClient(env,settings,workerModule('../../../tests/support/schedule-worker.js',import.meta.url)),scheduler=new Scheduler(env,builder);
  try{
    for(const action of ['scan_only','match_only','build_only','match_and_build','full'] as const){
      const {schedule}=await scheduler.create({library:'TV',cron:'* * * * *',action,enabled:false});
      const result=await scheduler.runNow(schedule.id);expect(result.job).toBeTruthy();
      await expect.poll(async()=>(await builder.queue.get(result.job!))?.status).toBe('completed');
      const row=(await scheduler.list()).find(r=>r.id===schedule.id)!;expect(row.last_status).toBe('ok');
      expect(row.last_message).toContain(action.includes('build')||action==='full'?'builds_queued=1':'builds_queued=0');
    }
    expect(getBinding(db,folder)?.external_id).toBe('42');
    expect((await builder.queue.list()).filter(job=>job.kind!=='schedule')).toHaveLength(3);
    const {schedule}=await scheduler.create({library:'TV',cron:'0 0 * * 7',action:'scan_only'});
    expect((await scheduler.update(schedule.id,{library:null})).schedule.library).toBeNull();
    const sunday=new Date('2026-09-13T00:00:00Z');await scheduler.tick(sunday);await scheduler.tick(sunday);
    expect((await builder.queue.list()).filter(job=>job.folder===`schedule:${schedule.id}`)).toHaveLength(1);
    const queued=(await builder.queue.list()).filter(job=>job.folder===`schedule:${schedule.id}`)[0]!;
    await expect.poll(async()=>(await builder.queue.get(queued.id))?.status).toBe('completed');
    const enqueue=builder.queue.enqueue.bind(builder.queue);
    const delayed=vi.spyOn(builder.queue,'enqueue').mockImplementation(async(...args)=>{await new Promise(r=>setTimeout(r,50));return enqueue(...args);});
    const concurrent=await Promise.all([scheduler.runNow(schedule.id),scheduler.runNow(schedule.id)]);
    expect(concurrent.filter(run=>run.already_running)).toHaveLength(1);expect(delayed).toHaveBeenCalledTimes(1);delayed.mockRestore();
    await scheduler.delete(schedule.id);await expect(scheduler.runNow(schedule.id)).rejects.toThrow('Schedule not found');
    await expect(scheduler.create({cron:'* * * * 8',action:'full'})).rejects.toThrow('validation');
  }finally{await scheduler.close();await builder.close();db.close();}
}),20000);
