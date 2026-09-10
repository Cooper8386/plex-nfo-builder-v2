import type { FastifyInstance } from 'fastify';
import type { WatcherStatus,WatcherEvent,WatcherReview } from 'shared';
import type { Watcher } from '../services/watcher/watcher.js';
export function watcherRoutes(app:FastifyInstance,watcher:Watcher,save:(enabled:boolean)=>Promise<void>) {
  app.get<{Reply:WatcherStatus}>('/api/watcher/status',()=>watcher.status());
  app.post<{Body:{enabled:boolean};Reply:{ok:true;status:WatcherStatus}}>('/api/watcher/toggle',{schema:{body:{type:'object',required:['enabled'],properties:{enabled:{type:'boolean'}}}}},async r=>{await save(r.body.enabled);await watcher.reload();return {ok:true,status:watcher.status()};});
  app.get<{Querystring:{limit?:number};Reply:{events:WatcherEvent[]}}>('/api/watcher/events',{schema:{querystring:{type:'object',properties:{limit:{type:'integer',minimum:0,maximum:500}}}}},r=>({events:watcher.events(r.query.limit)}));
  app.get<{Querystring:{library?:string};Reply:{items:WatcherReview[]}}>('/api/watcher/review',async r=>({items:await watcher.state.list(r.query.library)}));
  const schema={body:{type:'object',required:['folder_path'],properties:{folder_path:{type:'string',minLength:1}}}};
  app.post<{Body:{folder_path:string}}>('/api/watcher/review/retry',{schema},r=>watcher.retry(r.body.folder_path));
  app.post<{Body:{folder_path:string}}>('/api/watcher/review/resolve',{schema},async r=>({ok:true,removed:await watcher.state.resolve(r.body.folder_path)}));
  app.delete<{Querystring:{library?:string}}>('/api/watcher/review',async r=>({ok:true,cleared:await watcher.state.clear(r.query.library)}));
}
