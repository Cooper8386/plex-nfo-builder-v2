import { previewReset,applyReset } from './files.js';
export async function previewClean(folder:string,keepSidecar=true) {
  const plan=await previewReset(folder);
  if (keepSidecar) plan.files=plan.files.filter(file=>file.type!=='sidecar');
  return plan;
}
export const applyClean=applyReset;
