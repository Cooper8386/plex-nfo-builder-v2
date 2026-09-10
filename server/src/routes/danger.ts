import type { FastifyInstance } from 'fastify';
import type { DangerRequest,DangerResponse,DangerOperation } from 'shared';
import type { MatcherClient } from '../services/matcher/client.js';
const schema={body:{type:'object',properties:{folder_path:{type:'string',minLength:1},library:{type:'string',minLength:1},dry_run:{type:'boolean'},keep_sidecar:{type:'boolean'},delete_files:{type:'boolean'},rescan:{type:'boolean'},confirm:{type:'boolean'},preview_id:{type:'string'}}}};
export function dangerRoutes(app:FastifyInstance,client:MatcherClient) {
  for(const [path,op] of [['clean','clean'],['orphans/sweep','orphans'],['prune','prune'],['prune-empty','prune-empty']] as const)app.post<{Body:DangerRequest;Reply:DangerResponse}>(`/api/items/${path}`,{schema},r=>client.danger({...r.body,op}));
  app.get<{Querystring:{path:string};Reply:DangerResponse}>('/api/items/orphans',{schema:{querystring:{type:'object',required:['path'],properties:{path:{type:'string',minLength:1}}}}},r=>client.danger({op:'orphans',folder_path:r.query.path,dry_run:true}));
  for(const [path,op] of [['wipe-nfo','wipe-nfo'],['wipe-sidecars','wipe-sidecars'],['orphans/sweep','library-orphans']] satisfies [string,DangerOperation][])app.post<{Body:DangerRequest;Params:{name:string};Reply:DangerResponse}>(`/api/libraries/:name/${path}`,{schema},r=>{
    if(r.body.library!==r.params.name)throw new Error('Danger validation: Library name mismatch');
    return client.danger({...r.body,op});
  });
}
