import type Database from 'better-sqlite3';
import type { RenameRequest,RenamePreview } from 'shared';
import type { Settings } from '../../config/settings.js';
import type { Providers } from '../providers/providers.js';
import { buildTarget } from '../builder/builder.js';
import { effectiveSource } from '../matcher/effective-source.js';
import { previewRename,applyRename,captureMoves,type CapturedMove } from './renamer.js';
import { capturePreview,consumePreview } from '../cleaner/previews.js';
import { mediaPath } from '../../config/paths.js';
interface Captured {plan:RenamePreview;moves:Record<string,CapturedMove[]>}
export async function renameRequest(db:Database.Database,root:string,settings:Settings,providers:Providers,input:RenameRequest,apply=false) {
  if(!settings.rename_enabled)throw new Error('Rename validation: Renaming is disabled');
  const folderPath=await mediaPath(root,input.folder_path),key=JSON.stringify([root,'rename',folderPath]);
  if(apply){
    const captured=consumePreview<Captured>(key,input.preview_id,input.confirm);
    if(!input.only_src || input.only_src.some(src=>!captured.plan.items.some(item=>item.src===src)))throw new Error('Rename validation: Select only previewed sources');
    return applyRename(db,folderPath,captured.plan.items,input.only_src,captured.moves);
  }
  const {folder,library,snapshot}=await buildTarget(db,root,input.folder_path),binding=snapshot.binding!;
  const source=effectiveSource(binding,library,settings.metadata_source);let id=binding.external_id;
  if(binding.provider==='imdb')id=binding.secondary_provider===source&&binding.secondary_external_id?binding.secondary_external_id:(await providers[source].findImdb(id,binding.kind))[0]?.id??'';
  if(!id)throw new Error('Rename validation: Provider identity could not be resolved');
  let data;
  try{data=await providers.details(source,binding.kind,id,{language:binding.language??settings.preferred_language});}
  catch(error){throw new Error('Provider returned HTTP: Rename metadata lookup failed',{cause:error});}
  data.ids[binding.provider]=binding.external_id;
  if(binding.secondary_provider&&binding.secondary_external_id)data.ids[binding.secondary_provider]=binding.secondary_external_id;
  const plan=await previewRename(folder,data,snapshot,settings,input);
  const moves:Record<string,CapturedMove[]>={};
  for(const item of plan.items)if(!item.unchanged&&!item.conflict){moves[item.src]=await captureMoves(item);item.companions=moves[item.src]!.slice(1).map(({src,dst})=>({src,dst}));}
  return {...plan,preview_id:capturePreview(key,{plan,moves} satisfies Captured)};
}
