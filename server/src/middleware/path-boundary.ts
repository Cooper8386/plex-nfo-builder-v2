import { dirname,resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { isWithin } from '../config/paths.js';
// Check lexical escape before touching disk, then validate the nearest existing ancestor too.
export async function pathBoundary(root:string,path:string,mustExist=true){
  const lexicalRoot=resolve(root),target=resolve(root,path);
  if(!isWithin(lexicalRoot,target))throw new Error('Path outside MEDIA_ROOT');
  const base=await realpath(root);let ancestor=target;
  for(;;){
    let canonical:string;
    try{
      canonical=await realpath(ancestor);
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
      const parent=dirname(ancestor);if(parent===ancestor)throw error;ancestor=parent;continue;
    }
    if(!isWithin(base,canonical))throw new Error('Path outside MEDIA_ROOT');
    if(ancestor===target)return canonical;
    return mustExist?await realpath(target):target;
  }
}
