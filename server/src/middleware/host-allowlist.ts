import type { FastifyInstance } from 'fastify';
export function installHostAllowlist(app:FastifyInstance,hosts:string[]){
  if(hosts.length)app.addHook('onRequest',async(request,reply)=>{if(!hosts.includes(request.hostname.toLowerCase()))return reply.code(400).send({detail:'Invalid Host header'});});
}
