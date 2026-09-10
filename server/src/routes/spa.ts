import { open,realpath } from 'node:fs/promises';
import { extname,resolve } from 'node:path';
import type { FastifyInstance,FastifyReply } from 'fastify';
import { isWithin } from '../config/paths.js';

const types:Record<string,string>={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.ico':'image/x-icon'};
const missing=(reply:FastifyReply)=>reply.code(404).send({detail:'Not found'});
export function spaRoutes(app:FastifyInstance,root:string){
  async function serve(path:string,reply:FastifyReply,asset=false){
    try{
      const base=await realpath(root),target=await realpath(resolve(base,path));
      if(!isWithin(base,target))return missing(reply);
      const file=await open(target,'r');
      if(!(await file.stat()).isFile()){await file.close();return missing(reply);}
      return reply.header('X-Content-Type-Options','nosniff').header('Cache-Control',asset?'public, max-age=31536000, immutable':'no-store')
        .type(types[extname(target)]??'application/octet-stream').send(file.createReadStream());
    }catch(error){if(['ENOENT','ENOTDIR','EACCES'].includes((error as NodeJS.ErrnoException).code??''))return missing(reply);throw error;}
  }
  app.get<{Params:{'*':string}}>('/assets/*',async(request,reply)=>{
    const path=request.params['*'];
    if(path.includes('\\')||path.includes('\0')||path.split('/').some(part=>part.startsWith('.')))return missing(reply);
    return serve('assets/'+path,reply,true);
  });
  app.get<{Params:{'*':string}}> ('/*',async(request,reply)=>{
    const path=request.params['*'];
    // API/docs misses must keep their JSON status, never become successful HTML.
    if(/^(api|docs|redoc|openapi\.json)(\/|$)/.test(path)||(!path.startsWith('libraries/')&&extname(path))||path.split('/').some(part=>part.startsWith('.')))return missing(reply);
    return serve('index.html',reply);
  });
}
