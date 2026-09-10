import type { FastifyInstance } from 'fastify';
import type { RenameRequest,RenamePreview,RenameResult } from 'shared';
import type { MatcherClient } from '../services/matcher/client.js';
export function renameRoutes(app:FastifyInstance,client:MatcherClient) {
  const schema={body:{type:'object',required:['folder_path'],properties:{folder_path:{type:'string',minLength:1},template:{type:'string'},daily_template:{type:'string'},anime_template:{type:'string'},series_type:{enum:['auto','standard','daily','anime']},release_group:{type:'string'},only_src:{type:'array',items:{type:'string'}},preview_id:{type:'string'},confirm:{type:'boolean'}}}};
  app.post<{Body:RenameRequest;Reply:RenamePreview}>('/api/episodes/rename/preview',{schema},r=>client.rename<RenamePreview>(r.body));
  app.post<{Body:RenameRequest;Reply:RenameResult}>('/api/episodes/rename/apply',{schema},r=>client.rename<RenameResult>(r.body,true));
}
