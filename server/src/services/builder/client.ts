import type { BuildBulkRequest, BuildRequest, BuildResponse, BuildBulkResponse, ItemKind } from 'shared';
import type { Env } from '../../config/env.js';
import type { Settings } from '../../config/settings.js';
import { offLoop, workerModule } from '../fs/off-loop.js';
import { JobQueue } from '../../queue/queue.js';
export class BuilderClient {
  private targets=offLoop(workerModule('./targets.js',import.meta.url),{concurrency:1,timeoutMs:300_000});
  readonly queue:JobQueue;
  private started?:Promise<void>;
  constructor(private env:Env,private settings:()=>Settings,taskModule=workerModule('./builder.js',import.meta.url),concurrency=2) {
    this.queue=new JobQueue(env.config_dir,taskModule,concurrency,300_000,()=>({env:this.env,settings:this.settings()}));
  }
  start() {return this.started??=this.queue.start().catch(error=>{this.started=undefined;throw error;});}
  async build(request:BuildRequest):Promise<BuildResponse> {
    const [target]=await this.targets.run<{folder:string;kind:ItemKind}[]>({env:this.env,request,bulk:false});
    await this.start();
    return {ok:true,job:await this.queue.enqueue(target!.kind,target!.folder,{...request,folder_path:target!.folder,serialize_folder:true})};
  }
  async bulk(request:BuildBulkRequest):Promise<BuildBulkResponse> {
    const targets=await this.targets.run<{folder:string;kind:ItemKind}[]>({env:this.env,request,bulk:true});
    await this.start();const jobs:string[]=[];
    for (const target of targets) jobs.push(await this.queue.enqueue(target.kind,target.folder,{folder_path:target.folder,force:request.force??false,language:request.language,serialize_folder:true}));
    return {ok:true,queued:jobs.length,jobs};
  }
  async close() {await this.targets.close();await this.started?.catch(()=>{});await this.queue.close();}
}
