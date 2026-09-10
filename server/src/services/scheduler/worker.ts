import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Library,ScheduleAction } from 'shared';
import type { Env } from '../../config/env.js';
import { credential,type Settings } from '../../config/settings.js';
import { getBinding } from '../../db/queries.js';
import { enqueueJob } from '../../queue/jobs-table.js';
import { scanLibrary } from '../scanner/scanner.js';
import { Matcher } from '../matcher/matcher.js';
import { ProviderHttp } from '../providers/http.js';
import { TmdbClient } from '../providers/tmdb.js';
import { TvdbClient } from '../providers/tvdb.js';
export interface ScheduledRun {id:string;library:string|null;action:ScheduleAction}
export async function runScheduled(db:Database.Database,env:Env,settings:Settings,run:ScheduledRun){
  if(!db.prepare('SELECT 1 FROM schedules WHERE id=?').get(run.id))return;
  db.prepare("UPDATE schedules SET last_status='running' WHERE id=?").run(run.id);
  let scanned=0,matched=0,built=0;
  try{
    const libraries=db.prepare('SELECT * FROM libraries WHERE enabled=1 AND (? IS NULL OR name=?)').all(run.library,run.library) as Library[];
    const http=new ProviderHttp(db,settings.cache_ttl_hours*3600),matcher=new Matcher(db,env.media_root,settings,{tvdb:new TvdbClient(http,credential(settings,env,'tvdb_api_key')??'',credential(settings,env,'tvdb_pin')??''),tmdb:new TmdbClient(http,credential(settings,env,'tmdb_api_key')??'')});
    for(const library of libraries){
      // Every action refreshes local state; matching/building cannot use stale folder counts.
      scanned+=await scanLibrary(db,env.media_root,library.name);
      if(['match_only','match_and_build','full'].includes(run.action)){
        const result=await matcher.bulk({library:library.name,only_unmatched:true});matched+=result.matched;
        if(result.results.some(r=>r.reason==='error'))throw new Error('Scheduled matching failed for one or more folders');
      }
      if(['build_only','match_and_build','full'].includes(run.action)){
        const folders=db.prepare("SELECT folder_path FROM item_state WHERE library=? AND nfo_status!='complete'").all(library.name) as {folder_path:string}[];
        for(const row of folders){const binding=getBinding(db,row.folder_path);if(!binding)continue;
          enqueueJob(db,{id:randomUUID(),kind:binding.kind,folder:row.folder_path,payload:{folder_path:row.folder_path,serialize_folder:true}});built++;
        }
      }
    }
    const message=`libraries=${libraries.length} scanned=${scanned} matched=${matched} builds_queued=${built}`;
    db.prepare("UPDATE schedules SET last_status='ok',last_message=? WHERE id=?").run(message,run.id);return {scanned,matched,built};
  }catch(error){db.prepare("UPDATE schedules SET last_status='error',last_message=? WHERE id=?").run((error as Error).message,run.id);throw error;}
}
