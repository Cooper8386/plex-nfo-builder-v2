import type { FastifyInstance } from 'fastify';
import type { AutoBulkRequest, AutoBulkResponse, BindRequest, BindResponse, MatchSearchQuery, MatchSearchResponse, SetSecondaryRequest, SetSecondaryResponse, SetSourceRequest, SetSourceResponse, UnbindQuery, UnbindResponse } from 'shared';
import type { MatcherClient } from '../services/matcher/client.js';
const text = { type:'string',minLength:1,maxLength:4096,pattern:'\\S' };
const nullableText = { anyOf:[text,{type:'null'}] };
const year = { anyOf:[{type:'integer',minimum:1,maximum:9999},{type:'null'}] };
const kind = { type:'string',enum:['series','movie'] };
const boolean = { type:'boolean' };
const object = (properties: object, required: string[] = []) => ({type:'object',additionalProperties:false,properties,required});
export function matchRoutes(app: FastifyInstance, matcher: MatcherClient) {
  app.post<{Body:BindRequest;Reply:BindResponse}>('/api/match/bind',{schema:{body:object({folder_path:text,kind,provider:text,external_id:text,title:nullableText,year,language:nullableText,lock_source:boolean},['folder_path','kind','external_id'])}},request=>matcher.bind(request.body));
  app.post<{Body:SetSourceRequest;Reply:SetSourceResponse}>('/api/match/source',{schema:{body:object({folder_path:text,provider:text,external_id:nullableText,locked:boolean,kind,title:nullableText,year},['folder_path','provider'])}},request=>matcher.source(request.body));
  app.post<{Body:SetSecondaryRequest;Reply:SetSecondaryResponse}>('/api/match/secondary',{schema:{body:object({folder_path:text,provider:nullableText,external_id:nullableText},['folder_path'])}},request=>matcher.secondary(request.body));
  app.post<{Querystring:UnbindQuery;Reply:UnbindResponse}>('/api/match/unbind',{schema:{querystring:object({folder_path:text},['folder_path'])}},request=>matcher.unbind(request.query.folder_path));
  app.post<{Body:AutoBulkRequest;Reply:AutoBulkResponse}>('/api/match/auto-bulk',{schema:{body:object({folder_paths:{type:'array',items:text,maxItems:10000},library:text,only_unmatched:boolean,only_unbuilt:boolean,force:boolean,language:text})}},request=>matcher.bulk(request.body));
  app.get<{Querystring:MatchSearchQuery;Reply:MatchSearchResponse}>('/api/match/search',{schema:{querystring:object({q:{...text,maxLength:500},type:kind,year:{type:'integer',minimum:1,maximum:9999},language:text,provider:text,library:text},['q'])}},request=>matcher.search(request.query));
}
