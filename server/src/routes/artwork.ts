import type { FastifyInstance, FastifyReply } from 'fastify';
import multipart from '@fastify/multipart';
import type { ArtworkCandidatesQuery, ArtworkCandidatesResponse, ArtworkLanguagesResponse, ArtworkResponse, ClearArtworkRequest, CustomArtwork, CustomArtworkRequest, CustomArtworkResponse, SeasonPosterProgress, SelectArtworkRequest } from 'shared';
import type { MatcherClient } from '../services/matcher/client.js';
import { maxArtworkBytes } from '../services/artwork/download.js';

const text = {type:'string',minLength:1};
const object = (required: string[], properties: Record<string,unknown>)=>({type:'object',required,properties});
const pathQuery = object(['path'],{path:text,kind:{enum:['series','movie']}});
const sendFile = async (result: Promise<{data:string;content_type:string}>,reply:FastifyReply) => {const file=await result;return reply.header('X-Content-Type-Options','nosniff').type(file.content_type).send(Buffer.from(file.data,'base64'));};
export function artworkRoutes(app: FastifyInstance, client: MatcherClient) {
  app.register(async routes=>{
    await routes.register(multipart,{limits:{fileSize:maxArtworkBytes,files:1,fields:2,parts:3}});
    routes.get<{Querystring:ArtworkCandidatesQuery;Reply:ArtworkCandidatesResponse}>('/api/artwork/candidates',{schema:{querystring:pathQuery}},r=>client.artwork({op:'candidates',path:r.query.path}));
    routes.get<{Querystring:{path:string};Reply:SeasonPosterProgress}>('/api/artwork/progress',{schema:{querystring:pathQuery}},r=>client.artwork({op:'progress',path:r.query.path}));
    routes.post<{Body:SelectArtworkRequest;Reply:ArtworkResponse}>('/api/artwork/select',{schema:{body:object(['folder_path','slot','url'],{folder_path:text,slot:text,url:text,language:{type:['string','null']},score:{type:['number','null']}})}},r=>client.artwork({...r.body,op:'select'}));
    routes.post<{Body:ClearArtworkRequest;Reply:ArtworkResponse}>('/api/artwork/clear',{schema:{body:object(['folder_path'],{folder_path:text,slot:text})}},r=>client.artwork({...r.body,op:'clear'}));
    routes.get<{Reply:ArtworkLanguagesResponse}>('/api/artwork/languages',()=>client.artwork({op:'languages'}));
    routes.get<{Querystring:{path:string}}>('/api/artwork/file',{schema:{querystring:pathQuery}},(r,reply)=>sendFile(client.artwork({op:'file',path:r.query.path}),reply));
    routes.get<{Querystring:{folder_path:string};Reply:CustomArtworkResponse}>('/api/artwork/custom',{schema:{querystring:object(['folder_path'],{folder_path:text})}},r=>client.artwork({op:'custom-list',folder_path:r.query.folder_path}));
    routes.post<{Body:CustomArtworkRequest;Reply:CustomArtwork}>('/api/artwork/custom-url',{schema:{body:object(['folder_path','url'],{folder_path:text,url:text,slot:text})}},r=>client.artwork({...r.body,op:'register'}));
    routes.get<{Params:{id:string}}>('/api/artwork/custom/:id',(r,reply)=>sendFile(client.artwork({op:'custom-file',id:r.params.id}),reply));
    routes.delete<{Params:{id:string};Reply:ArtworkResponse}>('/api/artwork/custom/:id',r=>client.artwork({op:'custom-delete',id:r.params.id}));
    routes.post<{Reply:CustomArtwork}>('/api/artwork/upload',async r=>{
      let data: Buffer|undefined, content_type = ''; const fields: Record<string,string> = {};
      for await (const part of r.parts()) {
        if (part.type==='file') {data=await part.toBuffer();content_type=part.mimetype;}
        else if (typeof part.value==='string') fields[part.fieldname]=part.value;
      }
      if (!fields.folder_path || !data?.length) throw Object.assign(new Error('Empty image or missing folder_path'),{statusCode:400});
      return client.artwork({op:'register',folder_path:fields.folder_path,slot:fields.slot,data:data.toString('base64'),content_type});
    });
  });
}
