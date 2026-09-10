import type Database from 'better-sqlite3';
import { mediaPath } from '../../config/paths.js';
import { folderSnapshot, restoreSnapshot } from '../../db/queries.js';
import { recoverSidecar, writeSidecar } from '../sidecar/sidecar.js';
import type { Sidecar } from '../sidecar/format.js';
export type Overrides = Sidecar['overrides'];
export const fields = ['title','sorttitle','plot','tagline','originaltitle'] as const;
export const scopePattern = /^(series|movie|season-\d{2}|episode-[A-Za-z0-9_-]+)$/;
export function overridden(values: Overrides, scope: string, field: string, fallback: string) {
  return values.find(v => v.scope === scope && v.field === field)?.value || fallback;
}
export interface OverrideInput { folder_path: string; scope?: string; field?: string; value?: string | null }
export async function overrideRequest(db: Database.Database, root: string, action: 'get'|'set'|'clear', input: OverrideInput) {
  const folder = await mediaPath(root,input.folder_path);
  if (input.scope !== undefined && !scopePattern.test(input.scope) || input.field !== undefined && !fields.includes(input.field as typeof fields[number])) throw new Error('NFO validation: Invalid override scope or field');
  if (action === 'set' && (!input.scope || !input.field)) throw new Error('NFO validation: scope and field are required');
  if (action === 'get') return {path:folder,overrides:db.prepare('SELECT scope,field,value FROM nfo_overrides WHERE folder_path=? ORDER BY scope,field').all(folder)};
  await recoverSidecar(db,folder);
  const before = folderSnapshot(db,folder), next = {...before,overrides:before.overrides.filter(v => !((!input.scope || v.scope === input.scope) && (!input.field || v.field === input.field)))};
  if (action === 'set' && input.value) next.overrides.push({scope:input.scope!,field:input.field as typeof fields[number],value:input.value});
  await writeSidecar(folder,next);
  try {
    db.transaction(() => {
      restoreSnapshot(db,folder,next);
      const item = db.prepare('SELECT kind,title FROM item_state WHERE folder_path=?').get(folder) as {kind:string;title:string} | undefined;
      if (item) db.prepare('UPDATE item_state SET sort_title=? WHERE folder_path=?').run(overridden(next.overrides,item.kind,'sorttitle',item.title.replace(/^(the|a|an)\s+/i,'')),folder);
    })();
  } catch (error) { await writeSidecar(folder,before); throw error; }
  return {ok:true};
}
