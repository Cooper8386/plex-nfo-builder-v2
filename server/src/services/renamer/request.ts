import type Database from 'better-sqlite3';
import type { RenameRequest } from 'shared';
import type { Settings } from '../../config/settings.js';
import type { Providers } from '../providers/providers.js';
import { buildTarget } from '../builder/builder.js';
import { effectiveSource } from '../matcher/effective-source.js';
import { previewRename,applyRename } from './renamer.js';
export async function renameRequest(db:Database.Database,root:string,settings:Settings,providers:Providers,input:RenameRequest,apply=false) {
  if(!settings.rename_enabled)throw new Error('Rename validation: Renaming is disabled');
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
  return apply?applyRename(db,folder,plan.items,input.only_src):plan;
}
