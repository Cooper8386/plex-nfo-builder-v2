import { expect, test, vi } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { openDatabase } from '../../db/connection.js';
import { ProviderHttp, ProviderError, retryDelay, transport, type HttpReply, type RequestOptions } from './http.js';
import { TmdbClient } from './tmdb.js';
import { TvdbClient } from './tvdb.js';
import { FanartClient } from './fanart.js';
import { PlexClient, translatePath } from './plex.js';
import { Providers } from './providers.js';
import { guardUrl, isPublicAddress } from './ssrf.js';

const reply = (data: unknown, status = 200, headers = {}): HttpReply => ({ status, headers, body: Buffer.from(JSON.stringify(data)) });
test('providers HTTP honors Retry-After, three attempts, cache keys, force writes and 404 expiry', async () => withSandbox(async box => {
  const db = await openDatabase(box.config);
  try {
    const send = vi.fn().mockResolvedValueOnce(reply({}, 429, { 'retry-after': '2' })).mockResolvedValue(reply({ value: 1 }));
    const wait = vi.fn(async () => {}), http = new ProviderHttp(db, 168 * 3600, send, wait);
    expect(await http.json('https://example.com/a?z=2&a=1&api_key=secret')).toEqual({ value: 1 });
    expect(wait).toHaveBeenCalledWith(2000);
    await http.json('https://example.com/a?a=1&z=2&api_key=changed'); expect(send).toHaveBeenCalledTimes(2);
    send.mockResolvedValue(reply({ value: 2 }));
    await http.json('https://example.com/a?z=2&a=1', { force: true });
    expect(await http.json('https://example.com/a?a=1&z=2')).toEqual({ value: 2 });
    expect(send).toHaveBeenCalledTimes(3);
    const stored = db.prepare('SELECT key,ttl FROM provider_cache').get() as { key: string; ttl: number };
    expect(stored.key).not.toContain('secret'); expect(stored.ttl).toBe(168 * 3600);
    send.mockResolvedValue(reply({}, 503));
    await expect(http.json('https://example.com/fail')).rejects.toBeInstanceOf(ProviderError);
    expect(send).toHaveBeenCalledTimes(6);
    send.mockResolvedValue(reply({}, 404));
    const fanart = new FanartClient(http, 'key'); await fanart.artwork('movie', '1'); await fanart.artwork('movie', '1');
    expect(send).toHaveBeenCalledTimes(7);
    expect((db.prepare("SELECT ttl FROM provider_cache WHERE key LIKE '%fanart%'").get() as {ttl:number}).ttl).toBe(3600);
    db.prepare("UPDATE provider_cache SET fetched_at=0 WHERE key LIKE '%fanart%'").run();
    await fanart.artwork('movie', '1'); expect(send).toHaveBeenCalledTimes(8);
    expect(retryDelay(new Date(Date.now() + 5000).toUTCString(), 0)).toBeGreaterThan(3500);
  } finally { db.close(); }
}));

test('providers normalize TMDB details, season episodes and real movie cast; TVDB relogs and uses TMDB movie cast', async () => withSandbox(async box => {
  const db = await openDatabase(box.config); let loginCount = 0;
  const calls: string[] = [];
  const send = vi.fn(async (url: string, options: RequestOptions) => {
    const u = new URL(url); calls.push(u.pathname);
    if (u.pathname.endsWith('/login')) return reply({ data: { token: `token${++loginCount}` } });
    if (u.hostname.includes('thetvdb') && options.headers?.Authorization === 'Bearer token1') return reply({},401);
    if (u.pathname.endsWith('/movies/10/extended')) return reply({ data: { id:10, name:'Movie', year:'2020', characters:[{ peopleId:1, personName:'TVDB actor', peopleType:'Actor', name:'Role', sort:0 }], remoteIds:[{ sourceName:'TheMovieDB.com', id:'20' }] } });
    if (u.pathname.endsWith('/series/11/extended')) return reply({ data: { id:11, name:'Series', characters:[{ peopleId:2, personName:'Series actor', peopleType:'Actor', name:'Role', sort:1 }], seasons:[{ id:31, number:1, type:{id:1} }], artworks:[{ id:5,type:2,image:'https://example.com/poster',language:'eng' }] } });
    if (u.pathname.endsWith('/episodes/default')) return reply({ data: { episodes:[{ id:40,seasonNumber:1,number:1,name:'Pilot' }] }, links:{next:null} });
    if (u.pathname.endsWith('/seasons/31/extended')) return reply({ data:{ id:31,number:1,name:'Season One',overview:'Plot' } });
    if (u.pathname.endsWith('/movie/20')) {
      expect(u.searchParams.get('append_to_response')).toContain('credits');
      return reply({ id:20,title:'Movie',release_date:'2020-01-01',credits:{cast:[{id:2,name:'Second',character:'B',order:2},{id:1,name:'First',character:'A',order:0}]},images:{posters:[{file_path:'/poster.jpg',iso_639_1:'en',vote_average:5}]},external_ids:{imdb_id:'tt123'} });
    }
    if (u.pathname.endsWith('/tv/21')) return reply({ id:21,name:'TV',seasons:[{id:1,season_number:1}],credits:{cast:[{id:3,name:'TMDB series actor',character:'C'}]} });
    if (u.pathname.endsWith('/tv/21/season/1')) return reply({ id:1,name:'One',episodes:[{id:50,name:'Pilot',season_number:1,episode_number:1,air_date:'2020-01-01'}],images:{posters:[{file_path:'/season.jpg'}]} });
    throw new Error(`Unexpected fixture request ${u.pathname}`);
  });
  try {
    const http = new ProviderHttp(db, undefined, send, async () => {}), tmdb = new TmdbClient(http,'key'), tvdb = new TvdbClient(http,'key');
    const providers = new Providers(tvdb,tmdb);
    const movie = await providers.details('tvdb','movie','10');
    expect(movie.cast.map(c => c.name)).toEqual(['First','Second']); expect(movie.ids.tmdb).toBe('20'); expect(loginCount).toBe(2);
    expect(movie.cast[0]).toMatchObject({ character:'A',character_type:'actor' });
    const tv = await providers.details('tvdb','series','11');
    expect(tv.cast[0]?.name).toBe('Series actor'); expect(tv.episodes[0]).toMatchObject({id:'40',season:1,episode:1}); expect(tv.artwork[0]?.slot).toBe('poster');
    const series = await tmdb.details('series','21');
    expect(series.episodes[0]?.id).toBe('50'); expect(series.seasons[0]?.artwork[0]?.season).toBe(1);
    const count = send.mock.calls.length; await providers.details('tvdb','movie','10'); expect(send).toHaveBeenCalledTimes(count);
    expect(calls.filter(p => p.includes('login'))).toHaveLength(2);
  } finally { db.close(); }
}));

test('providers fanart normalizes artwork; Plex translates longest boundary and never raises', async () => withSandbox(async box => {
  const db = await openDatabase(box.config);
  const send = vi.fn(async (url: string) => {
    const u = new URL(url);
    if (u.hostname.includes('fanart')) return reply({ tvposter:[{id:'1',url:'https://example.com/p',lang:'en',likes:'5'}],seasonposter:[{id:'2',url:'https://example.com/s',season:'2'}] });
    if (u.pathname === '/identity') return reply({MediaContainer:{machineIdentifier:'id',version:'1',friendlyName:'Plex'}});
    if (u.pathname === '/library/sections') return reply({MediaContainer:{Directory:[{key:'1',title:'TV',type:'show',Location:[{path:'/plex/tv'}]}]}});
    expect(u.searchParams.get('path')).toBe('/plex/tv/Show'); return reply({});
  });
  try {
    const http = new ProviderHttp(db,undefined,send,async()=>{});
    const art = await new FanartClient(http,'key').artwork('series','1');
    expect(art[0]).toMatchObject({provider:'fanart',slot:'poster',score:5}); expect(art[1]?.season).toBe(2);
    const plex = new PlexClient(http,'https://plex.example.com','token');
    expect(await plex.identity()).toMatchObject({friendly_name:'Plex'});
    const mappings = [{from:'/media',to:'/wrong'},{from:'/media/TV',to:'/plex/tv'}];
    expect(translatePath('/media/TVExtra',mappings)).toBe('/wrong/TVExtra');
    expect(await plex.refresh('/media/TV/Show',mappings)).toBe(true);
    send.mockRejectedValue(new Error('Offline')); expect(await plex.identity()).toBeNull(); expect(await plex.sections()).toEqual([]); expect(await plex.refresh('/media/TV/Show',mappings)).toBe(false);
  } finally { db.close(); }
}));

test('providers SSRF denies private, loopback, mapped IPv6, metadata, rebinding answers and unsafe schemes', async () => {
  for (const address of ['127.0.0.1','10.1.2.3','172.16.1.2','192.168.1.1','169.254.169.254','100.100.100.200','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','0.0.0.0']) expect(isPublicAddress(address)).toBe(false);
  expect(isPublicAddress('8.8.8.8')).toBe(true); expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  for (const url of ['http://127.0.0.1','http://2130706433','http://[::1]','http://169.254.169.254/latest/meta-data','file:///etc/passwd','https://user:pass@example.com']) await expect(guardUrl(url)).rejects.toThrow();
  await expect(guardUrl('https://example.com',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}])).rejects.toThrow('Unsafe');
  await expect(transport('http://127.0.0.1',{})).rejects.toThrow('Unsafe');
});
