import type { FastifyInstance } from 'fastify';
import type { Schedule,ScheduleRequest } from 'shared';
import type { Scheduler } from '../services/scheduler/scheduler.js';
export function scheduleRoutes(app:FastifyInstance,scheduler:Scheduler){
  const properties={library:{anyOf:[{type:'string',minLength:1},{type:'null'}]},cron:{type:'string'},action:{type:'string'},enabled:{type:'boolean'}};
  app.get<{Reply:{schedules:Schedule[]}}>('/api/schedules',async()=>({schedules:await scheduler.list()}));
  app.post<{Body:ScheduleRequest}>('/api/schedules',{schema:{body:{type:'object',required:['cron','action'],additionalProperties:false,properties}}},r=>scheduler.create(r.body));
  app.patch<{Params:{id:string};Body:Partial<ScheduleRequest>}>('/api/schedules/:id',{schema:{body:{type:'object',additionalProperties:false,properties}}},r=>scheduler.update(r.params.id,r.body));
  app.delete<{Params:{id:string}}>('/api/schedules/:id',r=>scheduler.delete(r.params.id));
  app.post<{Params:{id:string}}>('/api/schedules/:id/run',async r=>{await scheduler.runNow(r.params.id);return {ok:true,started:true};});
}
