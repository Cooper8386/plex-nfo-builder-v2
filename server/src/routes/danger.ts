import type { FastifyInstance } from 'fastify';
import type { DangerRequest,DangerResponse,DangerOperation } from 'shared';
import type { MatcherClient } from '../services/matcher/client.js';
import type { RecordRequest,RecordResponse } from 'shared';
const schema={body:{type:'object',properties:{folder_path:{type:'string',minLength:1},library:{type:'string',minLength:1},dry_run:{type:'boolean'},keep_sidecar:{type:'boolean'},delete_files:{type:'boolean'},rescan:{type:'boolean'},confirm:{type:'boolean'},preview_id:{type:'string'}}}};
export const confirmationProperties={dry_run:{type:'boolean'},preview_id:{type:'string'},confirm:{type:'boolean'}};
export const confirmationQuery={querystring:{type:'object',properties:confirmationProperties}};
export function dangerRoutes(app:FastifyInstance,client:MatcherClient,onLibraryDelete:()=>Promise<void>) {
  app.post<{Body:RecordRequest;Reply:RecordResponse}>('/api/previews',{schema:{body:{type:'object',required:['op'],additionalProperties:false,properties:{op:{enum:['custom-delete','library-delete','review-clear','overrides-clear','artwork-clear','cache-clear']},folder_path:{type:'string'},library:{type:'string'},id:{type:'string'},scope:{type:'string'},field:{type:'string'},...confirmationProperties}}}},async r=>{const result=await client.preview(r.body);if(r.body.op==='library-delete'&&'ok' in result)await onLibraryDelete();return result;});
  for(const [path,op] of [['clean','clean'],['orphans/sweep','orphans'],['prune','prune'],['prune-empty','prune-empty']] as const)app.post<{Body:DangerRequest;Reply:DangerResponse}>(`/api/items/${path}`,{schema},r=>client.danger({...r.body,op}));
  app.get<{Querystring:{path:string};Reply:DangerResponse}>('/api/items/orphans',{schema:{querystring:{type:'object',required:['path'],properties:{path:{type:'string',minLength:1}}}}},r=>client.danger({op:'orphans',folder_path:r.query.path,dry_run:true}));
  for(const [path,op] of [['wipe-nfo','wipe-nfo'],['wipe-sidecars','wipe-sidecars'],['orphans/sweep','library-orphans']] satisfies [string,DangerOperation][])app.post<{Body:DangerRequest;Params:{name:string};Reply:DangerResponse}>(`/api/libraries/:name/${path}`,{schema},r=>{
    if(r.body.library!==r.params.name)throw new Error('Danger validation: Library name mismatch');
    return client.danger({...r.body,op});
  });
}
