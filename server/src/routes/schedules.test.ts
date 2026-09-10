import { expect,test } from 'vitest';
import { withSandbox } from '../../tests/support/sandbox.js';
import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
test('scheduler routes validate cron/actions, preserve nullable all-library scope and return missing statuses',async()=>withSandbox(async box=>{
  const app=createApp({env:loadEnv({MEDIA_ROOT:box.media,CONFIG_DIR:box.config,API_TOKEN:'test',WATCHER_ENABLED:'false'}),logger:false}),headers={'x-api-token':'test'};
  const post=(payload:object)=>app.inject({method:'POST',url:'/api/schedules',headers,payload});
  try{
    expect((await post({cron:'* * * * *',action:'invalid'})).statusCode).toBe(400);expect((await post({cron:'* * * * 8',action:'full'})).statusCode).toBe(400);
    const created=await post({cron:'0 0 * * 7',action:'scan_only',enabled:false});expect(created.statusCode,created.body).toBe(200);const id=created.json().schedule.id;
    const updated=await app.inject({method:'PATCH',url:'/api/schedules/'+id,headers,payload:{library:null}});expect(updated.json().schedule.library).toBeNull();
    expect((await app.inject({method:'POST',url:'/api/schedules/'+id+'/run',headers})).statusCode).toBe(200);
    expect((await app.inject({method:'DELETE',url:'/api/schedules/'+id,headers})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/schedules/'+id+'/run',headers})).statusCode).toBe(404);
    expect((await app.inject({method:'PATCH',url:'/api/schedules/'+id,headers,payload:{enabled:true}})).statusCode).toBe(404);
  }finally{await app.close();}
}));
