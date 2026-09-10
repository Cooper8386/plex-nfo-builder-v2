import type Database from 'better-sqlite3';
import type { BuildBulkRequest, BuildRequest, Item } from 'shared';
import type { Env } from '../../config/env.js';
import { openDatabase } from '../../db/connection.js';
import { buildTarget } from './builder.js';
import { detectKind } from '../scanner/layout.js';

let db:Database.Database|undefined, config:string|undefined;
export async function handle(input:{env:Env;request:BuildRequest|BuildBulkRequest;bulk:boolean}) {
  if (!db) {db=await openDatabase(input.env.config_dir);config=input.env.config_dir;}
  if (config!==input.env.config_dir) throw new Error('Build target worker owns one config directory');
  if (!input.bulk) {const request=input.request as BuildRequest;const target=await buildTarget(db,input.env.media_root,request.folder_path,request.kind);return [{folder:target.folder,kind:target.snapshot.binding!.kind}];}
  const request=input.request as BuildBulkRequest;
  if (!request.library && !request.folder_paths?.length) throw new Error('Build validation: Provide a library or folder_paths');
  if (request.library && !db.prepare('SELECT 1 FROM libraries WHERE name=?').get(request.library)) throw new Error('Library not found');
  const rows=db.prepare('SELECT * FROM item_state WHERE (? IS NULL OR library=?)').all(request.library??null,request.library??null) as Item[];
  const paths=[...new Set(request.folder_paths??rows.map(row=>row.folder_path))];
  const targets=[];
  for (const path of paths) {
    const target=await buildTarget(db,input.env.media_root,path,undefined,false);
    const row=rows.find(row=>row.folder_path===target.folder);
    if (request.only_unmatched && target.snapshot.binding || request.only_unbuilt && row?.nfo_status==='complete') continue;
    targets.push({folder:target.folder,kind:target.snapshot.binding?.kind??row?.kind??await detectKind(target.folder)});
  }
  return targets;
}
