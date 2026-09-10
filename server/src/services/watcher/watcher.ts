import { join,relative,resolve,sep } from 'node:path';
import type { WatcherStatus,WatcherEvent } from 'shared';
import type { Env } from '../../config/env.js';
import type { Settings } from '../../config/settings.js';
import type { ScannerClient } from '../scanner/client.js';
import type { MatcherClient } from '../matcher/client.js';
import type { BuilderClient } from '../builder/client.js';
import { WatcherState,type WatchTarget } from './state.js';
import { ObserverClient } from './observer.js';
interface Pending {due:number;stamp?:string}
export class Watcher {
  readonly state:WatcherState;
  private observer:ObserverClient;
  private pending=new Map<string,Pending>();
  private active=new Map<string,Promise<void>>();
  private history:WatcherEvent[]=[];
  private allowed=new Set<string>();
  private timer?:NodeJS.Timeout;
  private generation=0;
  private checking=false;
  private closed=false;
  constructor(private env:Env,private settings:()=>Settings,private scanner:Pick<ScannerClient,'libraries'|'scan'>,private matcher:Pick<MatcherClient,'bulk'>,private builder:Pick<BuilderClient,'build'>,private timing:{debounceMs?:number;stableMs?:number;pollMs?:number}={}) {
    this.state=new WatcherState(env);
    this.observer=new ObserverClient((_library,path)=>this.notify(path),message=>this.event('error','',message));
  }
  get enabled(){return !this.closed&&!this.env.watcher_kill_switch&&(this.settings().watcher_enabled??this.env.watcher_enabled);}
  private get debounce(){return this.timing.debounceMs??(this.settings().watcher_debounce_seconds??this.env.watcher_debounce_seconds)*1000;}
  status():WatcherStatus{return {available:true,enabled:this.enabled,running:this.observer.watchedPaths.length>0,debounce_seconds:this.debounce/1000,watched_paths:this.observer.watchedPaths,pending_count:this.pending.size,in_flight_count:this.active.size};}
  events(limit=200){return limit<=0?[]:this.history.slice(-Math.min(500,limit)).reverse();}
  private event(event_type:string,folder_path:string,message:string){this.history.push({timestamp:Date.now(),event_type,folder_path,library:folder_path?relative(this.env.media_root,folder_path).split(sep)[0]??null:null,message});if(this.history.length>500)this.history.shift();}
  async reload(){
    const generation=++this.generation;
    if(!this.enabled){this.pending.clear();this.allowed.clear();}
    const libraries=this.enabled?await this.scanner.libraries():[];
    if(generation!==this.generation||this.closed)return;
    this.allowed=new Set(libraries.filter(l=>l.enabled).map(l=>l.name));
    for(const folder of this.pending.keys())if(!this.allowed.has(relative(this.env.media_root,folder).split(sep)[0]!))this.pending.delete(folder);
    await this.observer.replace(libraries.filter(l=>l.enabled).map(l=>({library:l.name,path:join(this.env.media_root,l.name)})));
    if(generation!==this.generation||this.closed)return;
    this.timer??=setInterval(()=>{void this.tick();},this.timing.pollMs??250);this.timer.unref();
  }
  notify(path:string){
    if(!this.enabled)return;
    const parts=relative(resolve(this.env.media_root),resolve(path)).split(sep);
    if(parts.length<2||parts[0]==='..'||!this.observer.watchedPaths.some(p=>resolve(p)===resolve(this.env.media_root,parts[0]!)))return;
    const folder=join(this.env.media_root,parts[0]!,parts[1]!);
    this.pending.set(folder,{due:Date.now()+this.debounce});this.event('detected',folder,'Waiting for stable media');
  }
  async retry(folder:string){
    if(!this.enabled)throw new Error('Watcher validation: Watcher is disabled');
    const target=await this.state.inspect(folder);this.allowed.add(target.library);this.pending.set(target.folder,{due:Date.now()});
    this.timer??=setInterval(()=>{void this.tick();},this.timing.pollMs??250);this.timer.unref();
    this.event('retry',target.folder,'Pipeline re-armed');return {ok:true as const};
  }
  private async tick(){
    if(this.checking||!this.enabled)return;this.checking=true;
    try{for(const [folder,pending] of this.pending){
      if(!this.enabled||this.active.size>=this.env.watcher_max_inflight)break;
      if(pending.due>Date.now()||this.active.has(folder))continue;
      try{
        const target=await this.state.inspect(folder);
        if(!this.enabled||this.pending.get(folder)!==pending)continue;
        if(!target.videos){this.pending.delete(folder);continue;}
        if(pending.stamp!==target.stamp){this.pending.set(folder,{stamp:target.stamp,due:Date.now()+(pending.stamp?this.debounce:this.timing.stableMs??1000)});continue;}
        this.pending.delete(folder);
        const run=this.pipeline(target).catch(error=>this.event('error',folder,(error as Error).message)).finally(()=>this.active.delete(folder));this.active.set(folder,run);
      }catch(error){this.pending.delete(folder);this.event('error',folder,(error as Error).message);}
    }}finally{this.checking=false;}
  }
  private async pipeline(target:WatchTarget){
    const current=()=>this.enabled&&this.allowed.has(target.library);
    this.event('processing',target.folder,'Running scan, match and build pipeline');
    try{
      if(!target.bound){
        const result=(await this.matcher.bulk({folder_paths:[target.folder]})).results[0];
        if(!current())return;
        if(!result?.matched&&!(await this.state.inspect(target.folder)).bound){
          const reason=result?.reason==='low_confidence'?'low_confidence':result?.reason==='error'?'error':'no_match';
          await this.state.record({folder_path:target.folder,library:target.library,kind:target.kind,reason,detail:result?.detail??result?.reason??'No provider match'});this.event('queued_for_review',target.folder,reason);return;
        }
      }
      await this.scanner.scan(target.library);if(!current())return;
      const {job}=await this.builder.build({folder_path:target.folder});
      await this.state.resolve(target.folder);this.event('built',target.folder,`Build queued: ${job}`);
    }catch(error){await this.state.record({folder_path:target.folder,library:target.library,kind:target.kind,reason:'error',detail:(error as Error).message});this.event('queued_for_review',target.folder,(error as Error).message);}
  }
  async close(){this.closed=true;this.generation++;clearInterval(this.timer);this.pending.clear();await this.observer.close();while(this.checking)await new Promise(r=>setTimeout(r,5));await Promise.all(this.active.values());await this.state.close();}
}
