import { readFile, writeFile, readdir, symlink, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { writeTree } from '../../../tests/support/media-tree.js';
import { createApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';
import { settingsSchema } from '../../config/settings.js';
import { openDatabase } from '../../db/connection.js';
import { folderSnapshot, forgetFolder, restoreSnapshot } from '../../db/queries.js';
import { sidecarSchema } from '../sidecar/format.js';
import { recoverSidecar } from '../sidecar/sidecar.js';
import { Providers } from '../providers/providers.js';
import { TmdbClient } from '../providers/tmdb.js';
import { TvdbClient } from '../providers/tvdb.js';
import { FanartClient } from '../providers/fanart.js';
import { ProviderHttp } from '../providers/http.js';
import type { Artwork, Metadata } from '../providers/normalized.js';
import { writeNfos } from '../nfo/nfo.js';
import { ArtworkService, writeArtworkSet } from './artwork.js';
import { resolveArtwork } from './resolver.js';
import { saveArtwork } from './download.js';

const data: Metadata = {provider:'tvdb',kind:'series',id:'1',title:'Psych',year:2006,plot:'',image:null,original_title:'Psych',sort_title:'Psych',tagline:'',runtime:43,aired:null,genres:[],studios:[],rating:null,content_rating:'',status:'',ids:{tvdb:'1',tmdb:'2'},cast:[],artwork:[],seasons:[{id:'3',season:1,title:'One',plot:'',artwork:[]}],episodes:[{id:'4',season:1,episode:1,title:'Pilot',plot:'',aired:null,runtime:43,image:'https://example.com/episode.jpg'}]};
const art = (provider:'tvdb'|'tmdb',slot='poster',season:number|null=null):Artwork=>({provider,slot,season,id:provider+slot+season,url:`https://example.com/${provider}-${slot}-${season}.jpg`,thumb:null,language:provider==='tvdb'?'eng':'en',score:provider==='tvdb'?100:1,width:600,height:900});

test('artwork preferred TMDB on a TVDB show writes the same source as NFO; seasons require saved choices',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'Show/Season 01/Psych.S01E01.mkv':''});
  const folder=join(box.media,'Show'), settings=settingsSchema.parse({preferred_artwork_source:'tmdb'});
  const choices=[art('tvdb'),art('tmdb'),art('tvdb','background'),art('tmdb','background'),art('tmdb','poster',1)];
  const selected=resolveArtwork(choices,settings,'tvdb',[{slot:'season-01-poster',url:'https://example.com/manual-season.jpg',language:null,score:0}]);
  const result=await writeArtworkSet(folder,data,selected.urls,async(url,path)=>saveArtwork(path,Buffer.from(url)));
  await writeNfos(folder,data,{urls:result.urls});
  const nfo=await readFile(join(folder,'tvshow.nfo'),'utf8');
  expect(await readFile(join(folder,'poster.jpg'),'utf8')).toBe(art('tmdb').url);expect(nfo).toContain(art('tmdb').url);
  expect(await readFile(join(folder,'background.jpg'),'utf8')).toBe(art('tmdb','background').url);expect(nfo).toContain(art('tmdb','background').url);
  expect(await readFile(join(folder,'Season01-poster.jpg'),'utf8')).toBe('https://example.com/manual-season.jpg');
  expect(await readFile(join(folder,'Season 01/season.nfo'),'utf8')).toContain('https://example.com/manual-season.jpg');
  expect(await readFile(join(folder,'Season 01/Psych.S01E01-thumb.jpg'),'utf8')).toBe(data.episodes[0]!.image);
  expect(resolveArtwork(choices,settings,'tvdb').urls).not.toHaveProperty('season-01-poster');
}));

test('artwork aggregates the secondary provider and original-language images without forcing TVDB for television',async()=>withSandbox(async box=>{
  const db=await openDatabase(box.config), calls:URL[]=[];
  const http=new ProviderHttp(db,3600,async value=>{
    const url=new URL(value);calls.push(url);
    const payload=url.pathname.endsWith('/images')?{posters:[{file_path:'/original.jpg',iso_639_1:'ja'}]}:url.pathname.endsWith('/tv/2')?{id:2,name:'Psych',original_language:'ja',seasons:[{id:3,season_number:1}]}:url.pathname.endsWith('/season/1')?{id:3,name:'One',episodes:[]}:{configuration:'unused'};
    return {status:200,headers:{},body:Buffer.from(JSON.stringify(payload))};
  });
  try {
    const providers=new Providers(new TvdbClient(http,''),new TmdbClient(http,'key'));
    const service=new ArtworkService(db,box.media,box.config,settingsSchema.parse({fanart_enabled:false}),providers,new FanartClient(http,''));
    const result=await service.aggregate({...data,artwork:[art('tvdb')]});
    expect(result.warnings).toEqual([]);expect(result.artwork.some(a=>a.provider==='tmdb'&&a.language==='ja')).toBe(true);
    const images=calls.filter(url=>url.pathname.endsWith('/images'));expect(images).toHaveLength(2);
    expect(images.every(url=>!url.searchParams.has('language')&&!url.searchParams.has('include_image_language'))).toBe(true);
  } finally {db.close();}
}));

test('artwork routes persist manual choices, report progress and validate custom uploads and paths',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'TV/Psych/Season 01/Psych.S01E01.mkv':'','TV/Psych/Season 02/Psych.S02E01.mkv':''});
  const folder=join(box.media,'TV/Psych'), app=createApp({env:loadEnv({MEDIA_ROOT:box.media,CONFIG_DIR:box.config,API_TOKEN:'test'}),logger:false});
  const headers={'x-api-token':'test'};
  const select=(slot:string)=>app.inject({method:'POST',url:'/api/artwork/select',headers,payload:{folder_path:folder,slot,url:'https://example.com/chosen.jpg'}});
  try {
    expect((await app.inject({url:'/api/artwork/progress?path='+encodeURIComponent(folder),headers})).json().state).toBe('not_started');
    expect((await select('season-01-poster')).statusCode).toBe(200);
    expect((await app.inject({url:'/api/artwork/progress?path='+encodeURIComponent(folder),headers})).json()).toMatchObject({state:'in_progress',missing_seasons:[2]});
    await select('season-02-poster');
    expect((await app.inject({url:'/api/artwork/progress?path='+encodeURIComponent(folder),headers})).json().state).toBe('selected');
    expect((await select('../../escape')).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:'/api/artwork/custom-url',headers,payload:{folder_path:folder,url:'file:///etc/passwd'}})).statusCode).toBe(400);
    expect((await app.inject({url:'/api/artwork/file?path='+encodeURIComponent(box.config),headers})).statusCode).toBe(400);
    expect((await app.inject({url:'/api/artwork/candidates?path='+encodeURIComponent(folder),headers})).statusCode).toBe(400);
    const boundary='artwork-test';
    const payload=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="folder_path"\r\n\r\n${folder}\r\n--${boundary}\r\nContent-Disposition: form-data; name="slot"\r\n\r\nseason-01-poster\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="poster.png"\r\nContent-Type: image/png\r\n\r\npng-test-image\r\n--${boundary}--\r\n`);
    const upload=await app.inject({method:'POST',url:'/api/artwork/upload',headers:{...headers,'content-type':`multipart/form-data; boundary=${boundary}`},payload});
    expect(upload.statusCode,upload.body).toBe(200);const custom=upload.json();
    expect((await app.inject({url:custom.url,headers})).body).toBe('png-test-image');
    expect((await app.inject({method:'POST',url:'/api/artwork/select',headers,payload:{folder_path:folder,slot:'season-01-poster',url:custom.url}})).statusCode).toBe(200);
    expect((await app.inject({method:'DELETE',url:custom.url,headers})).statusCode).toBe(400);
    const preview=(await app.inject({method:'POST',url:'/api/previews',headers,payload:{op:'custom-delete',id:custom.id,dry_run:true}})).json();
    expect((await app.inject({method:'DELETE',url:custom.url+'?'+new URLSearchParams({preview_id:preview.preview_id,confirm:'true'}),headers})).statusCode).toBe(200);
    expect((await app.inject({url:custom.url,headers})).statusCode).toBe(404);
    expect((await app.inject({url:'/api/artwork/progress?path='+encodeURIComponent(folder),headers})).json().state).toBe('in_progress');
    expect((await app.inject({url:'/api/artwork/languages',headers})).json()).toEqual({tvdb:[],tmdb:[]});
    expect((await app.inject({url:'/api/artwork/languages'})).statusCode).toBe(401);
    const sidecar=JSON.parse(await readFile(join(folder,'.plex-nfo-builder.json'),'utf8'));expect(sidecar.artwork_selections.map((v:{slot:string})=>v.slot)).toEqual(['season-02-poster']);
  } finally {await app.close();}
}));

test('artwork custom choice survives database loss and stream failures preserve previous files',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'Show/Season 01/S01E01.mkv':''});const folder=join(box.media,'Show');
  const db=await openDatabase(box.config), http=new ProviderHttp(db);
  const service=new ArtworkService(db,box.media,box.config,settingsSchema.parse({}),new Providers(new TvdbClient(http,''),new TmdbClient(http,'')),new FanartClient(http,''));
  try {
    restoreSnapshot(db,folder,sidecarSchema.parse({version:2,binding:{provider:'tvdb',external_id:'1',kind:'series'}}));
    const custom=await service.register({folder_path:folder,slot:'season-01-poster',data:Buffer.from('image').toString('base64'),content_type:'image/png'});
    await service.select({folder_path:folder,slot:custom.slot,url:custom.url});
    forgetFolder(db,folder);expect(await recoverSidecar(db,folder)).toBe(true);
    expect(folderSnapshot(db,folder).artwork_selections[0]?.url).toBe(custom.url);
    await service.download(custom.url,join(folder,'Season01-poster.jpg'));expect(await readFile(join(folder,'Season01-poster.jpg'),'utf8')).toBe('image');
    expect(await service.progress(folder)).toMatchObject({state:'selected'});
    const written=await service.write(folder,{...data,episodes:[]},{'season-01-poster':custom.url});
    await writeNfos(folder,data,{urls:written.urls});
    expect(await readFile(join(folder,'Season 01/season.nfo'),'utf8')).toContain('<thumb>../Season01-poster.jpg</thumb>');
    const before=await readFile(join(folder,'.plex-nfo-builder.json'),'utf8');
    await expect(service.select({folder_path:folder,slot:'season-01-poster',url:'javascript:bad'})).rejects.toThrow('http(s)');
    expect(await readFile(join(folder,'.plex-nfo-builder.json'),'utf8')).toBe(before);
    const failed=vi.fn(async()=>{throw new Error('offline');});await writeFile(join(folder,'poster.jpg'),'old');
    await expect(writeArtworkSet(folder,data,{poster:'https://example.com/new'},failed)).rejects.toThrow('offline');
    expect(await readFile(join(folder,'poster.jpg'),'utf8')).toBe('old');expect((await readdir(folder)).some(file=>file.endsWith('.part'))).toBe(false);
  } finally {db.close();}
}));

test('artwork custom symlinks cannot expose or delete config files',async()=>withSandbox(async box=>{
  const db=await openDatabase(box.config), http=new ProviderHttp(db);
  const service=new ArtworkService(db,box.media,box.config,settingsSchema.parse({}),new Providers(new TvdbClient(http,''),new TmdbClient(http,'')),new FanartClient(http,''));
  try {
    const custom=await service.register({folder_path:box.media,data:Buffer.from('image').toString('base64'),content_type:'image/png'});
    const protectedFile=join(box.config,'settings.json');await writeFile(protectedFile,'preserve');await unlink(custom.file_path!);
    await symlink(protectedFile,custom.file_path!,'file');
    await expect(service.file(custom.id,true)).rejects.toThrow('regular file');
    await expect(service.removeCustom(custom.id)).rejects.toThrow('regular file');
    expect(await readFile(protectedFile,'utf8')).toBe('preserve');
    await unlink(custom.file_path!);
  } finally {db.close();}
}));
