import type Database from 'better-sqlite3';
import type { RecordRequest,RecordResponse } from 'shared';
import type { ArtworkService } from '../artwork/artwork.js';
import { folderSnapshot,restoreSnapshot } from '../../db/queries.js';
import { recoverSidecar,writeSidecar } from '../sidecar/sidecar.js';
import { mediaPath } from '../../config/paths.js';
import { isWithin } from '../../config/paths.js';
import { join } from 'node:path';
import { capturePreview,consumePreview,fileStamp,checkFile } from '../cleaner/previews.js';
import { deleteLibrary } from './items.js';
import { fields,scopePattern } from '../nfo/overrides.js';
type Row=Record<string,unknown>;
interface Captured {rows:Row[];files:{path:string;stamp:string}[];targets:string[]}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const invalid=()=>new Error('Danger validation: Targets changed since preview. Preview again.');
function libraryRows(db:Database.Database,base:string,name:string):Row[]{
  const library=db.prepare('SELECT * FROM libraries WHERE name=?').get(name) as Row|undefined;
  if(!library)throw new Error('Library not found');
  const rows:Row[]=[{table:'libraries',...library}];
  for(const table of ['item_state','bindings','nfo_overrides','artwork_selections','active_artwork','custom_artwork','episode_overrides','episode_file_overrides','custom_tags','watcher_review'])rows.push(...(db.prepare(`SELECT rowid AS _rowid,* FROM ${table} ORDER BY rowid`).all() as Row[]).filter(row=>isWithin(base,String(row.folder_path))).map(row=>({table,...row})));
  return rows;
}
export async function recordPreview(db:Database.Database,root:string,artwork:ArtworkService,input:RecordRequest):Promise<RecordResponse>{
  if(input.op==='library-delete'&&!input.library)throw new Error('Danger validation: library is required');
  if(input.op==='custom-delete'&&!input.id)throw new Error('Danger validation: id is required');
  if(input.op==='overrides-clear'&&(input.scope!==undefined&&!scopePattern.test(input.scope)||input.field!==undefined&&!fields.includes(input.field as typeof fields[number])))throw new Error('Danger validation: Invalid override scope or field');
  const folder=input.folder_path?await mediaPath(root,input.folder_path):undefined;
  const key=JSON.stringify([root,input.op,folder,input.library,input.id,input.scope,input.field]);
  let rows:Row[],targets:string[],paths:string[]=[];
  if(input.op==='custom-delete'){
    const row=db.prepare('SELECT * FROM custom_artwork WHERE id=?').get(input.id??'') as Row|undefined;
    if(!row)throw new Error('Artwork file not found');
    const url=row.source==='upload'?`/api/artwork/custom/${input.id}`:row.origin;
    const refs=db.prepare('SELECT * FROM artwork_selections WHERE url=? ORDER BY folder_path,slot').all(url) as Row[];
    rows=[row,...refs];targets=[`Custom image ${input.id}`,...refs.map(ref=>`${ref.folder_path}: ${ref.slot}`)];
    if(row.source==='upload')paths=[await artwork.customFile(input.id!)];
  }else if(input.op==='library-delete'){
    const base=join(await mediaPath(root,'.'),input.library!);
    rows=libraryRows(db,base,input.library!);
    targets=[`Library ${input.library}`,...new Set(rows.flatMap(row=>typeof row.folder_path==='string'?[row.folder_path]:[]))];
  }else if(input.op==='review-clear'){
    rows=db.prepare('SELECT * FROM watcher_review WHERE (? IS NULL OR library=?) ORDER BY folder_path').all(input.library??null,input.library??null) as Row[];
    targets=rows.map(row=>String(row.folder_path));
  }else if(input.op==='cache-clear'){
    rows=db.prepare('SELECT * FROM provider_cache ORDER BY key').all() as Row[];targets=rows.map(row=>String(row.key));
  }else{
    if(!folder)throw new Error('Danger validation: folder_path is required');
    await recoverSidecar(db,folder);
    const snapshot=folderSnapshot(db,folder);
    rows=input.op==='artwork-clear'?snapshot.artwork_selections:snapshot.overrides.filter(row=>(!input.scope||row.scope===input.scope)&&(!input.field||row.field===input.field));
    targets=rows.map(row=>`${folder}: ${row.slot??`${row.scope} / ${row.field}`}`);
  }
  if(input.dry_run){
    const files=await Promise.all(paths.map(async path=>({path,stamp:await fileStamp(path)})));
    return {dry_run:true,preview_id:capturePreview(key,{rows,files,targets} satisfies Captured),targets,files:paths};
  }
  const captured=consumePreview<Captured>(key,input.preview_id,input.confirm);
  let removed=0;
  if(input.op==='custom-delete'){
    if(!same(rows,captured.rows))throw invalid();
    for(const file of captured.files)await checkFile(file.path,file.stamp);
    await artwork.removeCustom(input.id!,captured.files[0]);removed=captured.targets.length;
  }else if(input.op==='library-delete'){
    if(!same(rows,captured.rows))throw invalid();
    // deleteLibrary revalidates the path. All captured records must still match before deletion.
    const base=join(await mediaPath(root,'.'),input.library!);
    await deleteLibrary(db,root,input.library!,()=>{if(!same(libraryRows(db,base,input.library!),captured.rows))throw invalid();});removed=captured.targets.length;
  }else if(input.op==='review-clear'||input.op==='cache-clear'){
    const table=input.op==='review-clear'?'watcher_review':'provider_cache',field=input.op==='review-clear'?'folder_path':'key';
    db.transaction(()=>{for(const row of captured.rows){
      const current=db.prepare(`SELECT * FROM ${table} WHERE ${field}=?`).get(row[field]) as Row|undefined;
      if(same(current,row))removed+=db.prepare(`DELETE FROM ${table} WHERE ${field}=?`).run(row[field]).changes;
    }})();
  }else{
    const before=folderSnapshot(db,folder!),next=structuredClone(before);
    if(input.op==='artwork-clear')next.artwork_selections=before.artwork_selections.filter(row=>!captured.rows.some(old=>same(row,old)));
    else next.overrides=before.overrides.filter(row=>!captured.rows.some(old=>same(row,old)));
    removed=input.op==='artwork-clear'?before.artwork_selections.length-next.artwork_selections.length:before.overrides.length-next.overrides.length;
    await writeSidecar(folder!,next);
    try{restoreSnapshot(db,folder!,next);}catch(error){await writeSidecar(folder!,before);throw error;}
    if(input.op==='overrides-clear'){
      const item=db.prepare('SELECT kind,title FROM item_state WHERE folder_path=?').get(folder) as {kind:string;title:string}|undefined;
      if(item)db.prepare('UPDATE item_state SET sort_title=? WHERE folder_path=?').run(next.overrides.find(row=>row.scope===item.kind&&row.field==='sorttitle')?.value||item.title.replace(/^(the|a|an)\s+/i,''),folder);
    }
  }
  return {ok:true,removed,skipped:Math.max(0,captured.targets.length-removed)};
}
