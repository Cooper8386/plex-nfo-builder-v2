import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Schedule,ScheduleRequest } from 'shared';
import type { Env } from '../../config/env.js';
import { openDatabase } from '../../db/connection.js';
import { offLoop,workerModule } from '../fs/off-loop.js';
import type { BuilderClient } from '../builder/client.js';
import { parseCron,cronMatches } from './cron.js';
const actions=['scan_only','match_only','build_only','match_and_build','full'];
const fail=(message:string)=>{throw new Error('Schedule validation: '+message);};
let db:Database.Database|undefined;
interface Input {env:Env;op:'list'|'create'|'update'|'delete'|'claim'|'error'|'recover';id?:string;request?:Partial<ScheduleRequest>;now?:number;message?:string}
export async function handle(input:Input) {
  db??=await openDatabase(input.env.config_dir);const database=db;
  const get=()=>database.prepare('SELECT * FROM schedules WHERE id=?').get(input.id!) as Schedule|undefined;
  if(input.op==='list')return db.prepare('SELECT * FROM schedules ORDER BY created_at,id').all();
  if(input.op==='recover'){
    db.prepare("UPDATE schedules SET last_status='error',last_message='Interrupted before completion; run again explicitly' WHERE last_status IN ('queued','running') AND NOT EXISTS (SELECT 1 FROM jobs WHERE json_extract(payload,'$.schedule.id')=schedules.id AND status IN ('queued','running'))").run();return;
  }
  if(input.op==='claim')return db.transaction(()=>{
    const row=get();if(!row)throw new Error('Schedule not found');if(['queued','running'].includes(row.last_status??'')){
      const job=db!.prepare("SELECT status FROM jobs WHERE json_extract(payload,'$.schedule.id')=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(input.id!) as {status:string}|undefined;
      if(!job||['queued','running'].includes(job.status))return null;
    }
    db!.prepare("UPDATE schedules SET last_run=?,last_status='queued',last_message=NULL WHERE id=?").run(input.now??Date.now(),input.id!);return row;
  }).immediate();
  if(input.op==='error'){db.prepare("UPDATE schedules SET last_status='error',last_message=? WHERE id=?").run(input.message!,input.id!);return;}
  if(input.op==='delete'){if(!db.prepare('DELETE FROM schedules WHERE id=?').run(input.id!).changes)throw new Error('Schedule not found');return {ok:true,deleted:1};}
  const old=input.op==='update'?get():undefined;if(input.op==='update'&&!old)throw new Error('Schedule not found');
  const request=input.request??{},cron=request.cron??old?.cron??'',action=request.action??old?.action??'';
  if(!actions.includes(action))fail('Invalid action');try{parseCron(cron);}catch(error){throw new Error('Schedule validation: Invalid cron',{cause:error});}
  const library=request.library===undefined?old?.library??null:request.library;
  if(library!==null&&!db.prepare('SELECT 1 FROM libraries WHERE name=?').get(library))fail('Unknown library');
  const now=Date.now(),id=old?.id??randomUUID(),enabled=request.enabled===undefined?old?.enabled??1:Number(request.enabled);
  if(old)db.prepare('UPDATE schedules SET library=?,cron=?,action=?,enabled=?,updated_at=? WHERE id=?').run(library,cron,action,enabled,now,id);
  else db.prepare('INSERT INTO schedules(id,library,cron,action,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id,library,cron,action,enabled,now,now);
  return {ok:true,schedule:db.prepare('SELECT * FROM schedules WHERE id=?').get(id)};
}
export class Scheduler {
  private state=offLoop(workerModule('./scheduler.js',import.meta.url),{concurrency:1});
  private timer?:NodeJS.Timeout;
  private ticking=false;
  private closed=false;
  private started?:Promise<void>;
  private launching=new Set<string>();
  lastError:string|null=null;
  constructor(private env:Env,private builder:Pick<BuilderClient,'start'|'queue'>){}
  private run<T>(op:Input['op'],fields:Omit<Partial<Input>,'env'|'op'>={}){return this.state.run<T>({env:this.env,op,...fields});}
  list(){return this.run<Schedule[]>('list');}
  create(request:ScheduleRequest){return this.run<{ok:true;schedule:Schedule}>('create',{request});}
  update(id:string,request:Partial<ScheduleRequest>){return this.run<{ok:true;schedule:Schedule}>('update',{id,request});}
  delete(id:string){return this.run<{ok:true;deleted:number}>('delete',{id});}
  private initialize(){return this.started??=this.builder.start().then(()=>this.run<void>('recover')).catch(error=>{this.started=undefined;throw error;});}
  async start(){await this.initialize();if(this.closed)return;this.timer??=setInterval(()=>{void this.tick().catch(error=>{this.lastError=(error as Error).message;});},1000);this.timer.unref();}
  async runNow(id:string,now=Date.now()):Promise<{ok:true;job?:string;already_running?:boolean}>{
    if(this.launching.has(id))return {ok:true,already_running:true};
    this.launching.add(id);
    try{
    await this.initialize();
    const row=await this.run<Schedule|null>('claim',{id,now});if(!row)return {ok:true as const,already_running:true};
    try{const job=await this.builder.queue.enqueue('schedule',`schedule:${id}`,{schedule:{id:row.id,library:row.library,action:row.action},serialize_folder:true});return {ok:true as const,job};}
    catch(error){await this.run('error',{id,message:(error as Error).message});throw error;}
    }finally{this.launching.delete(id);}
  }
  async tick(now=new Date()){
    if(this.closed||this.ticking)return;this.ticking=true;
    try{for(const row of await this.list())if(row.enabled&&Math.floor((row.last_run??0)/60_000)!==Math.floor(now.getTime()/60_000)){
      try{if(cronMatches(row.cron,now))await this.runNow(row.id,now.getTime());}catch(error){await this.run('error',{id:row.id,message:(error as Error).message});}
    }}finally{this.ticking=false;}
  }
  async close(){this.closed=true;clearInterval(this.timer);while(this.ticking)await new Promise(r=>setTimeout(r,5));await this.state.close();}
}
