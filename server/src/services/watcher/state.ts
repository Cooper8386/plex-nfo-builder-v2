import { lstat,readdir } from 'node:fs/promises';
import { join,relative,sep } from 'node:path';
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Library,WatcherReview } from 'shared';
import type { Env } from '../../config/env.js';
import { mediaPath } from '../../config/paths.js';
import { openDatabase } from '../../db/connection.js';
import { getBinding } from '../../db/queries.js';
import { detectKind,videoPattern } from '../scanner/layout.js';
import { offLoop,workerModule } from '../fs/off-loop.js';
export async function inspectFolder(db:Database.Database,root:string,path:string) {
  let folder:string;
  try{folder=await mediaPath(root,path);}catch(error){throw new Error('Watcher validation: Missing or outside media root',{cause:error});}
  const parts=relative(await mediaPath(root,'.'),folder).split(sep);
  if(parts.length!==2||!(await lstat(folder)).isDirectory())throw new Error('Watcher validation: Expected an item folder inside a library');
  const library=db.prepare('SELECT * FROM libraries WHERE name=?').get(parts[0]!) as Library|undefined;
  if(!library?.enabled)throw new Error('Watcher validation: Library is missing or disabled');
  const hash=createHash('sha256');let videos=0;
  async function walk(path:string){for(const entry of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;
    const file=join(path,entry.name);
    if(entry.isDirectory())await walk(file);
    else if(entry.isFile()&&videoPattern.test(entry.name)){const info=await lstat(file);hash.update(JSON.stringify([relative(folder,file),info.size,info.mtimeMs]));videos++;}
  }}
  await walk(folder);const binding=getBinding(db,folder);
  return {folder,library:library.name,kind:binding?.kind??await detectKind(folder),bound:!!binding,stamp:hash.digest('hex'),videos};
}
export type WatchTarget=Awaited<ReturnType<typeof inspectFolder>>;
interface Input {env:Env;op:'inspect'|'list'|'resolve'|'clear'|'record';folder?:string;library?:string;review?:Pick<WatcherReview,'folder_path'|'library'|'kind'|'reason'|'detail'>}
let db:Database.Database|undefined;
export async function handle(input:Input) {
  db??=await openDatabase(input.env.config_dir);
  if(input.op==='inspect')return inspectFolder(db,input.env.media_root,input.folder!);
  if(input.op==='list')return db.prepare('SELECT * FROM watcher_review WHERE (? IS NULL OR library=?) ORDER BY detected_at DESC').all(input.library??null,input.library??null);
  if(input.op==='resolve')return db.prepare('DELETE FROM watcher_review WHERE folder_path=?').run(input.folder!).changes;
  if(input.op==='clear')return db.prepare('DELETE FROM watcher_review WHERE (? IS NULL OR library=?)').run(input.library??null,input.library??null).changes;
  const row=input.review!,now=Date.now();
  db.prepare(`INSERT INTO watcher_review(folder_path,library,kind,reason,detail,detected_at,last_attempt_at,attempts) VALUES (@folder_path,@library,@kind,@reason,@detail,@now,@now,1)
    ON CONFLICT(folder_path) DO UPDATE SET reason=excluded.reason,detail=excluded.detail,last_attempt_at=excluded.last_attempt_at,attempts=watcher_review.attempts+1`).run({...row,now});
}
export class WatcherState {
  private pool=offLoop(workerModule('./state.js',import.meta.url),{concurrency:1,timeoutMs:300_000});
  constructor(private env:Env){}
  inspect(folder:string){return this.pool.run<WatchTarget>({env:this.env,op:'inspect',folder} satisfies Input);}
  list(library?:string){return this.pool.run<WatcherReview[]>({env:this.env,op:'list',library} satisfies Input);}
  resolve(folder:string){return this.pool.run<number>({env:this.env,op:'resolve',folder} satisfies Input);}
  clear(library?:string){return this.pool.run<number>({env:this.env,op:'clear',library} satisfies Input);}
  record(review:Input['review']){return this.pool.run<void>({env:this.env,op:'record',review} satisfies Input);}
  close(){return this.pool.close();}
}
