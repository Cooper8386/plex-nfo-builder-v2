import { join } from 'node:path';
import { mkdir,readFile,symlink } from 'node:fs/promises';
import { expect,test,vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { safeUrl } from '../../src/middleware/auth.js';
import { withSandbox } from '../support/sandbox.js';
import { writeTree } from '../support/media-tree.js';
const headers={'x-api-token':'contract-token'};
test('contract API status codes, boundary checks and protected docs',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'TV/Show/S01E01.mkv':''});
  const app=createApp({env:loadEnv({MEDIA_ROOT:box.media,CONFIG_DIR:box.config,API_TOKEN:'contract-token',WATCHER_KILL_SWITCH:'true'}),logger:false});
  const folder=join(box.media,'TV/Show');
  const get=(url:string)=>app.inject({url,headers});
  const post=(url:string,payload:object)=>app.inject({method:'POST',url,headers,payload});
  const error=(response:{statusCode:number;json:()=>unknown},status:number)=>{expect(response.statusCode).toBe(status);expect(response.json()).toEqual({detail:expect.any(String)});};
  try{
    await app.scanner.detect();await app.scanner.scan('TV');
    error(await app.inject({url:'/api/version'}),401);
    for(const path of ['/docs','/openapi.json','/redoc','/docs/oauth2-redirect']){error(await app.inject({url:path}),401);expect((await get(path)).statusCode).toBe(404);}
    expect((await app.inject({url:'/api/version?api_token=contract-token'})).statusCode).toBe(200);
    expect(safeUrl('/api/version?api_token=contract-token')).toBe('/api/version');
    error(await get('/api/browse?path='+encodeURIComponent(join(box.config,'does-not-exist'))),400);
    error(await get('/api/browse?path='+encodeURIComponent(join(folder,'does-not-exist'))),404);
    const link=join(box.media,'escape');await symlink(box.config,link,process.platform==='win32'?'junction':'dir');
    error(await get('/api/browse?path='+encodeURIComponent(join(link,'missing'))),400);
    error(await post('/api/episodes/override',{}),422);
    error(await post('/api/settings',{actors_limit:-1,unknown_setting:true}),422);
    error(await get('/api/episodes?path='+encodeURIComponent(folder)),400);
    await app.matcher.bind({folder_path:folder,kind:'series',provider:'tmdb',external_id:'1'});
    error(await post('/api/episodes/override',{folder_path:folder,season:1,episode:1,tvdb_episode_id:'   '}),422);
    error(await get('/api/episodes?path='+encodeURIComponent(folder)),502);
    error(await get('/api/plex/sections'),400);
    // Concrete request-body limit, without allocating a 50MB multipart fixture.
    error(await post('/api/items/tags',{folder_path:folder,tag:'x'.repeat(1_100_000)}),413);
    const broken=vi.spyOn(app.scanner,'libraries').mockRejectedValueOnce(new Error('private storage detail'));
    const failure=await get('/api/libraries');error(failure,500);expect(failure.body).not.toContain('private storage detail');broken.mockRestore();
    error(await get('/api/jobs/missing'),404);
    const detail=await get('/api/items/detail?path='+encodeURIComponent(folder));expect(detail.statusCode,detail.body).toBe(200);expect(detail.json().season_poster_progress.state).toBe('not_started');
    expect((await get('/api/logs/app')).json()).toEqual({lines:[]});
    error(await post('/api/tvdb/cache/clear',{}),400);
    const cachePreview=(await post('/api/tvdb/cache/clear',{dry_run:true})).json();
    expect((await post('/api/tvdb/cache/clear',{preview_id:cachePreview.preview_id,confirm:true})).json()).toMatchObject({ok:true,removed:expect.any(Number)});
    error(await post('/api/plex/refresh',{path:' '}),400);
  }finally{await app.close();}
  const unset=createApp({env:loadEnv({MEDIA_ROOT:box.media,CONFIG_DIR:box.config}),logger:false});
  try{error(await unset.inject({url:'/api/version'}),503);}finally{await unset.close();}
  const trusted=createApp({env:loadEnv({MEDIA_ROOT:box.media,CONFIG_DIR:box.config,API_TOKEN:'contract-token',TRUSTED_HOSTS:'allowed.example'}),logger:false});
  try{error(await trusted.inject({url:'/api/version',headers:{...headers,host:'bad.example'}}),400);}finally{await trusted.close();}
}));
test('contract settings, database-only removal, jobs and log responses',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'TV/Show/S01E01.mkv':'media'});
  const app=createApp({env:loadEnv({MEDIA_ROOT:box.media,CONFIG_DIR:box.config,API_TOKEN:'contract-token',WATCHER_KILL_SWITCH:'true'}),logger:false});
  const folder=join(box.media,'TV/Show'),get=(url:string)=>app.inject({url,headers}),post=(url:string,payload:object)=>app.inject({method:'POST',url,headers,payload});
  try{
    await app.scanner.detect();await app.scanner.scan('TV');
    expect((await post('/api/settings',{tmdb_api_key:'saved-secret',plex_refresh_delay_seconds:900})).json()).toEqual({ok:true});
    expect((await post('/api/settings',{tmdb_api_key:''})).json()).toEqual({ok:true});
    const settings=await get('/api/settings');expect(settings.json()).toMatchObject({tmdb_api_key_configured:true,plex_refresh_delay_seconds:600,auto_sweep_orphans:false});expect(settings.body).not.toContain('saved-secret');
    expect((await post('/api/items/tags',{folder_path:folder,tag:'Favorite'})).json()).toEqual({ok:true});
    expect(JSON.parse(await readFile(join(folder,'.plex-nfo-builder.json'),'utf8')).custom_tags).toEqual(['Favorite']);
    expect((await post('/api/items/remove',{folder_path:folder})).json()).toEqual({ok:true});expect(await readFile(join(folder,'S01E01.mkv'),'utf8')).toBe('media');
    // Queue reads must strip internal payloads before serializing them to HTTP.
    const id=await app.builder.queue.enqueue('series',folder,{internal_marker:'do-not-expose'});
    const jobs=await get('/api/jobs');expect(jobs.json().jobs[0].id).toBe(id);expect(jobs.body).not.toContain('payload');expect(jobs.body).not.toContain('do-not-expose');
    const stored=(await app.builder.queue.get(id))!;
    const listing=vi.spyOn(app.builder.queue,'list').mockResolvedValue(Array.from({length:201},(_,index)=>({...stored,id:String(index)})));
    const latest=(await get('/api/jobs')).json().jobs;expect(latest).toHaveLength(200);expect(latest[0].id).toBe('200');expect(latest.at(-1).id).toBe('1');listing.mockRestore();
    expect((await get('/api/jobs/'+id)).json().status).toBe('queued');
    await mkdir(join(box.config,'logs/jobs'),{recursive:true});await writeTree(box.config,{['logs/jobs/'+id+'.log']:'line one\nline two\n'});
    const log=await get('/api/jobs/'+id+'/log');expect(log.headers['content-type']).toContain('text/plain');expect(log.body).toBe('line one\nline two\n');
    expect((await get('/api/jobs/00000000-0000-4000-8000-000000000000/log')).statusCode).toBe(404);
  }finally{await app.close();}
}));
