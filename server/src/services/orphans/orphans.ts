import { basename,dirname,extname } from 'node:path';
import { readdir } from 'node:fs/promises';
import { previewReset,applyReset,type Candidate,type ResetPlan } from '../cleaner/files.js';
import { removableType } from '../cleaner/patterns.js';
import { videoPattern } from '../scanner/layout.js';
async function isOrphan(file:Candidate) {
  const name=basename(file.path),lower=name.toLowerCase();
  if (file.directory || !['nfo','thumbnail'].includes(file.type) || ['tvshow.nfo','season.nfo','movie.nfo'].includes(lower) || removableType(name)==='artwork' || file.path.split(/[\\/]/).some(p=>p.toLowerCase()==='.actors')) return false;
  const stem=(file.type==='nfo'?name.slice(0,-4):name.replace(/-thumb\.[^.]+$/i,'')).toLowerCase();
  return !(await readdir(dirname(file.path),{withFileTypes:true})).some(entry=>(entry.isFile()||entry.isSymbolicLink())&&videoPattern.test(entry.name)&&basename(entry.name,extname(entry.name)).toLowerCase()===stem);
}
export async function previewOrphans(folder:string) {
  const plan=await previewReset(folder),files:Candidate[]=[];
  for (const file of plan.files) if (await isOrphan(file)) files.push(file);
  return {...plan,files};
}
export const applyOrphans=(plan:ResetPlan,confirm=false)=>applyReset(plan,confirm,isOrphan);
