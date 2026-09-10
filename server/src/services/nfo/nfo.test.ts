import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { expect,test,vi } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { writeTree } from '../../../tests/support/media-tree.js';
import type { Metadata } from '../providers/normalized.js';
import { renderItem,renderEpisode,renderSeason,writeNfo,writeNfos } from './nfo.js';
import { classifyStatus } from '../scanner/status.js';
import { tvdbCast } from '../providers/tvdb.js';
import { tmdbCast } from '../providers/tmdb.js';
vi.mock('node:fs/promises',async importOriginal=>({...await importOriginal<typeof fs>(),rename:vi.fn((await importOriginal<typeof fs>()).rename)}));
export const metadata: Metadata = {provider:'tvdb',kind:'series',id:'1',title:'A & <Show>',year:2020,plot:'Plot',image:null,original_title:'Original',sort_title:'Show',tagline:'Tagline',runtime:30,aired:'2020-01-01',genres:['Drama'],studios:['Studio'],rating:8,content_rating:'TV-PG',status:'Continuing',ids:{tvdb:'1',tmdb:'2'},cast:[],artwork:[],seasons:[{id:'3',season:1,title:'Season One',plot:'',artwork:[]}],episodes:[{id:'4',season:1,episode:1,title:'Pilot',plot:'Episode plot',aired:'2020-01-01',runtime:30,image:null}]};
test('nfo never emits movie crew as actors from either provider',()=>{
  const tvdb=tvdbCast([{peopleId:1,personName:'Actor',peopleType:'Actor',sort:1},{peopleId:2,personName:'Director',peopleType:'Director',sort:0}]);
  const credits={cast:[{id:1,name:'Actor',character:'Lead',order:1}],crew:[{id:2,name:'Director',job:'Director'}]};
  for(const cast of [tvdb,tmdbCast(credits.cast)]){const xml=renderItem({...metadata,kind:'movie',cast});expect(xml).toContain('<name>Actor</name>');expect(xml).not.toContain('Director');expect(xml.match(/<actor>/g)).toHaveLength(1);}
});
test('nfo renders every type, escaped text, scoped overrides and no empty IDs',()=>{
  const text=renderItem(metadata,{overrides:[{scope:'series',field:'plot',value:''},{scope:'series',field:'title',value:'Custom & Title'}]});
  expect(text).toContain('<title>Custom &amp; Title</title>');expect(text).toContain('<plot>Plot</plot>');
  expect(renderItem({...metadata,id:'',ids:{tvdb:'',tmdb:' ',imdb:'0'}})).not.toContain('<uniqueid');
  expect(renderItem({...metadata,id:'',ids:{imdb:'\u0001'}})).not.toContain('<uniqueid');
  expect(renderEpisode({...metadata.episodes[0]!,id:''},'tvdb')).not.toContain('<uniqueid');
  expect(renderSeason({id:'',season:0,title:'Specials',plot:'',artwork:[]})).toBeNull();
  expect(renderSeason({id:'',season:1,title:'',plot:'',artwork:[]})).toBeNull();
  expect(renderSeason({id:'',season:0,title:'',plot:'',artwork:[]},{overrides:[{scope:'season-00',field:'title',value:'Special'}]})).toContain('<title>Special</title>');
});
test('nfo writes complete root-video, season and movie layouts including empty movie fallback',async()=>withSandbox(async box=>{
  await writeTree(box.media,{'Root/a.S01E01.mkv':'','Season/Season 01/a.S01E01.mkv':'','Movie/a.mkv':'','Empty/placeholder.txt':''});
  for(const name of ['Root','Season']){const folder=join(box.media,name);await writeNfos(folder,metadata);expect((await classifyStatus(folder,'series')).status).toBe('complete');}
  const movie={...metadata,kind:'movie' as const};await writeNfos(join(box.media,'Movie'),movie);await writeNfos(join(box.media,'Empty'),movie);
  expect(await fs.readFile(join(box.media,'Empty/movie.nfo'),'utf8')).toContain('<movie>');
}));
test('nfo replacement exposes only complete content and preserves original on failed replacement',async()=>withSandbox(async box=>{
  const path=join(box.media,'movie.nfo');await fs.writeFile(path,'old');
  const actual=await vi.importActual<typeof fs>('node:fs/promises');
  vi.mocked(fs.rename).mockImplementationOnce(async(from,to)=>{expect(await fs.readFile(path,'utf8')).toBe('old');expect(await fs.readFile(from,'utf8')).toBe('complete');await actual.rename(from,to);});
  await writeNfo(path,'complete');expect(await fs.readFile(path,'utf8')).toBe('complete');
  vi.mocked(fs.rename).mockRejectedValueOnce(new Error('replacement failed'));await expect(writeNfo(path,'new')).rejects.toThrow('replacement failed');
  expect(await fs.readFile(path,'utf8')).toBe('complete');expect(await fs.readdir(box.media)).toEqual(['movie.nfo']);
}));
