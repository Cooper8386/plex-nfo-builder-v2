import { randomUUID } from 'node:crypto';
import { relative,sep } from 'node:path';
import type Database from 'better-sqlite3';
import type { DangerOperation,DangerRequest,DangerResponse } from 'shared';
import { mediaPath } from '../../config/paths.js';
import { previewClean,applyClean } from './cleaner.js';
import { previewOrphans,applyOrphans } from '../orphans/orphans.js';
import { previewPrune,applyPrune } from './prune.js';
import type { ResetPlan } from './files.js';
import { scanLibrary } from '../scanner/scanner.js';
export type DangerInput=DangerRequest&{op:DangerOperation};
interface Captured {key:string;expires:number;plans:ResetPlan[];prune?:Awaited<ReturnType<typeof previewPrune>>;input:DangerInput}
const previews=new Map<string,Captured>();
const fail=(message:string)=>{throw new Error('Danger validation: '+message);};
export async function dangerRequest(db:Database.Database,root:string,input:DangerInput):Promise<DangerResponse> {
  const base=await mediaPath(root,'.'),key=JSON.stringify([base,input.op,input.folder_path??null,input.library??null]);
  if (input.dry_run) {
    for (const [id,value] of previews) if(value.expires<Date.now())previews.delete(id);
    if(previews.size>=100)previews.delete(previews.keys().next().value!);
    const captured:Captured={key,expires:Date.now()+30*60_000,plans:[],input:{...input}};
    if(input.op==='prune'||input.op==='prune-empty') captured.prune=await previewPrune(db,base,{library:input.library,empty:input.op==='prune-empty',deleteFiles:input.delete_files??false});
    else {
      let folders:string[];
      if(input.op==='clean'||input.op==='orphans') folders=[input.folder_path??fail('folder_path is required')];
      else {
        if(!input.library)fail('library is required');
        if(!db.prepare('SELECT 1 FROM libraries WHERE name=?').get(input.library!))throw new Error('Library not found');
        folders=(db.prepare('SELECT folder_path FROM item_state WHERE library=?').all(input.library!) as {folder_path:string}[]).map(row=>row.folder_path);
      }
      for(const path of folders) {
        const folder=await mediaPath(base,path);
        if(relative(base,folder).split(sep).length!==2)fail('Expected an item folder immediately inside a library');
        const plan=input.op==='orphans'||input.op==='library-orphans'?await previewOrphans(folder):await previewClean(folder,input.op==='wipe-sidecars'?false:input.keep_sidecar??true);
        if(input.op==='wipe-sidecars')plan.files=plan.files.filter(file=>file.type==='sidecar');
        captured.plans.push(plan);
      }
    }
    const id=randomUUID();previews.set(id,captured);
    const filePlans=[...captured.plans,...captured.prune?.folders.flatMap(folder=>folder.files?[folder.files]:[])??[]];
    return {dry_run:true,preview_id:id,files:filePlans.flatMap(plan=>plan.files.map(file=>file.path)),folders:captured.prune?.folders.map(folder=>folder.folder)??[],skipped:filePlans.flatMap(plan=>plan.skipped)};
  }
  if(!input.confirm||!input.preview_id)fail('Explicit confirmation and preview_id are required');
  const captured=previews.get(input.preview_id!);
  if(!captured||captured.expires<Date.now()||captured.key!==key)fail('Preview expired, consumed, or belongs to another operation');
  previews.delete(input.preview_id!);
  const result:{removed:string[];skipped:{path:string;reason:string}[]}={removed:[],skipped:[]};
  if(captured!.prune)Object.assign(result,await applyPrune(db,captured!.prune,true));
  else for(const plan of captured!.plans) {
    const applied=input.op==='orphans'||input.op==='library-orphans'?await applyOrphans(plan,true):await applyClean(plan,true);
    result.removed.push(...applied.removed);result.skipped.push(...applied.skipped);
    for(const path of applied.removed)db.prepare('DELETE FROM active_artwork WHERE source_path=?').run(path);
  }
  if(captured!.input.rescan!==false&&!captured!.prune) {
    const libraries=new Set(captured!.plans.map(plan=>relative(base,plan.root).split(sep)[0]!));
    for(const library of libraries)await scanLibrary(db,base,library);
  }
  return {ok:true,...result};
}
