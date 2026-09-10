import { relative, sep, join } from 'node:path';
import { stat } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import type { BuildRequest, ItemKind, Library } from 'shared';
import type { Env } from '../../config/env.js';
import { credential, type Settings } from '../../config/settings.js';
import { mediaPath } from '../../config/paths.js';
import { openDatabase } from '../../db/connection.js';
import { folderSnapshot } from '../../db/queries.js';
import { ProviderHttp, type Transport } from '../providers/http.js';
import { TvdbClient } from '../providers/tvdb.js';
import { TmdbClient } from '../providers/tmdb.js';
import { Providers } from '../providers/providers.js';
import { FanartClient } from '../providers/fanart.js';
import { ArtworkService } from '../artwork/artwork.js';
import { resolveArtwork } from '../artwork/resolver.js';
import { downloadActors } from '../artwork/actors.js';
import { recoverSidecar } from '../sidecar/sidecar.js';
import { writeNfos } from '../nfo/nfo.js';
import { scanLibrary } from '../scanner/scanner.js';
import { classifyStatus } from '../scanner/status.js';
import { effectiveSource } from '../matcher/effective-source.js';
import type { StoredJob } from '../../queue/jobs-table.js';
import { previewOrphans,applyOrphans } from '../orphans/orphans.js';
import { runScheduled,type ScheduledRun } from '../scheduler/worker.js';

export async function buildTarget(db: Database.Database, root: string, path: string, kind?: ItemKind, requireBinding=true) {
  const folder=await mediaPath(root,path), parts=relative(await mediaPath(root,'.'),folder).split(sep);
  if (parts.length!==2 || !(await stat(folder)).isDirectory()) throw new Error('Build validation: Expected an item folder inside a library');
  const library=db.prepare('SELECT * FROM libraries WHERE name=?').get(parts[0]!) as Library|undefined;
  if (!library) throw new Error('Library not found');
  await recoverSidecar(db,folder);
  const snapshot=folderSnapshot(db,folder);
  if (!snapshot.binding && requireBinding) throw new Error('Build validation: Bind this item before building');
  if (kind && snapshot.binding && kind!==snapshot.binding.kind) throw new Error('Build validation: Kind disagrees with binding');
  return {folder,library,snapshot};
}
export async function buildItem(db:Database.Database,env:Env,settings:Settings,input:BuildRequest,testing: {send?:Transport;download?:(url:string,path:string)=>Promise<void>}={}) {
  const {folder,library,snapshot}=await buildTarget(db,env.media_root,input.folder_path,input.kind), binding=snapshot.binding!;
  const http=new ProviderHttp(db,settings.cache_ttl_hours*3600,testing.send);
  const providers=new Providers(new TvdbClient(http,credential(settings,env,'tvdb_api_key')??'',credential(settings,env,'tvdb_pin')??undefined),new TmdbClient(http,credential(settings,env,'tmdb_api_key')??''));
  const source=effectiveSource(binding,library,settings.metadata_source);let id=binding.external_id;
  if (binding.provider==='imdb') {
    if (binding.secondary_provider===source && binding.secondary_external_id) id=binding.secondary_external_id;
    else {
      const found=await providers[source].findImdb(binding.external_id,binding.kind);
      if (!found[0]) throw new Error('Build validation: IMDb identity needs a resolvable provider record or secondary ID');
      id=found[0].id;
    }
  }
  const data=await providers.details(source,binding.kind,id,{force:input.force,language:input.language??binding.language??settings.preferred_language,secondaryTmdbId:binding.secondary_provider==='tmdb'?binding.secondary_external_id??undefined:undefined});
  if (binding.provider==='imdb') data.ids.imdb=binding.external_id;
  if (binding.secondary_provider && binding.secondary_external_id) data.ids[binding.secondary_provider]=binding.secondary_external_id;
  const artwork=new ArtworkService(db,env.media_root,env.config_dir,settings,providers,new FanartClient(http,credential(settings,env,'fanart_api_key')??''));
  if (testing.download) artwork.download=testing.download;
  const candidates=await artwork.aggregate(data,binding.secondary_provider,binding.secondary_external_id,input.force);
  const selected=resolveArtwork(candidates.artwork,settings,source,snapshot.artwork_selections);
  if (!selected.urls.poster) throw new Error('Build validation: No poster available; select or upload a poster before building');
  const mappings={fileOverrides:snapshot.episode_file_overrides,episodeOverrides:snapshot.episode_overrides};
  const written=await artwork.write(folder,data,selected.urls,mappings);
  if (!settings.include_original_title) data.original_title='';
  await writeNfos(folder,data,{...mappings,urls:written.urls,overrides:snapshot.overrides,tags:snapshot.custom_tags,overwriteForeign:settings.overwrite_foreign_nfo});
  const actors=await downloadActors(folder,data.cast,(url,path)=>artwork.download(url,path));
  if(settings.auto_sweep_orphans)await applyOrphans(await previewOrphans(folder),true);
  await scanLibrary(db,env.media_root,library.name);
  const status=await classifyStatus(folder,binding.kind);
  const rootNfo=binding.kind==='series'?join(folder,'tvshow.nfo'):null;
  if (rootNfo) await stat(rootNfo);
  await stat(join(folder,'poster.jpg'));
  db.prepare('UPDATE item_state SET last_built=?,episode_count_tvdb=? WHERE folder_path=?').run(Date.now(),data.episodes.length,folder);
  return {folder,status:status.status,artwork:written.files,actor_failures:actors.failed,warnings:candidates.warnings};
}

let database:Database.Database|undefined, config:string|undefined;
export async function handle(job:StoredJob & {context:{env:Env;settings:Settings}}) {
  const {env,settings}=job.context;
  if (!database) {database=await openDatabase(env.config_dir);config=env.config_dir;}
  if (config!==env.config_dir) throw new Error('Build worker owns one config directory');
  if(job.kind==='schedule')return runScheduled(database,env,settings,(job.payload as {schedule:ScheduledRun}).schedule);
  return buildItem(database,env,settings,job.payload as BuildRequest);
}
