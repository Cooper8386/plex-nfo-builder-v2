import type { FastifyInstance } from 'fastify';
import type { OverrideRequest,ClearOverridesRequest,OverridesResponse,OverrideResponse } from 'shared';
import type { MatcherClient } from '../services/matcher/client.js';
import type { RecordRequest,RecordResponse } from 'shared';
import { confirmationProperties } from './danger.js';
const text={type:'string',minLength:1};
export function overrideRoutes(app: FastifyInstance, client: MatcherClient) {
  app.get<{Querystring:{path:string};Reply:OverridesResponse}>('/api/overrides',{schema:{querystring:{type:'object',required:['path'],properties:{path:text}}}},r=>client.overrides(r.query.path));
  app.post<{Body:OverrideRequest;Reply:OverrideResponse}>('/api/overrides',{schema:{body:{type:'object',required:['folder_path','scope','field'],properties:{folder_path:text,scope:text,field:text,value:{type:['string','null']}}}}},r=>client.setOverride(r.body));
  app.post<{Body:ClearOverridesRequest&Partial<RecordRequest>;Reply:OverrideResponse|RecordResponse}>('/api/overrides/clear',{schema:{body:{type:'object',required:['folder_path'],properties:{folder_path:text,scope:text,field:text,...confirmationProperties}}}},r=>r.body.scope&&r.body.field?client.clearOverrides(r.body):client.preview({...r.body,op:'overrides-clear'}));
}
