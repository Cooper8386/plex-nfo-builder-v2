import type { Env } from '../../src/config/env.js';
import type { Settings } from '../../src/config/settings.js';
import type { StoredJob } from '../../src/queue/jobs-table.js';
import { openDatabase } from '../../src/db/connection.js';
import { runScheduled,type ScheduledRun } from '../../src/services/scheduler/worker.js';
export async function handle(job:StoredJob&{context:{env:Env;settings:Settings}}){
  if(job.kind!=='schedule')return {accepted_build:job.folder};
  const db=await openDatabase(job.context.env.config_dir);
  try{return await runScheduled(db,job.context.env,job.context.settings,(job.payload as {schedule:ScheduledRun}).schedule);}finally{db.close();}
}
