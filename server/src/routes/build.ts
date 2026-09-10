import type { FastifyInstance } from 'fastify';
import type { BuildRequest, BuildBulkRequest, BuildResponse, BuildBulkResponse } from 'shared';
import type { BuilderClient } from '../services/builder/client.js';
export function buildRoutes(app:FastifyInstance,client:BuilderClient) {
  app.post<{Body:BuildRequest;Reply:BuildResponse}>('/api/build',{schema:{body:{type:'object',required:['folder_path'],properties:{folder_path:{type:'string',minLength:1},kind:{enum:['series','movie']},force:{type:'boolean'},language:{type:'string'}}}}},r=>client.build(r.body));
  app.post<{Body:BuildBulkRequest;Reply:BuildBulkResponse}>('/api/build/bulk',{schema:{body:{type:'object',properties:{library:{type:'string',minLength:1},folder_paths:{type:'array',items:{type:'string',minLength:1}},only_unmatched:{type:'boolean'},only_unbuilt:{type:'boolean'},force:{type:'boolean'},language:{type:'string'}}}}},r=>client.bulk(r.body));
}
