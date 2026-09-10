import koffi from 'koffi';
import { dirname,resolve,toNamespacedPath } from 'node:path';
let move:((src:string,dst:string)=>void)|undefined;
// Worker-only: the OS must atomically refuse an arriving destination. fs.rename replaces it.
export function renameNoReplace(src:string,dst:string) {
  if(dirname(resolve(src))!==dirname(resolve(dst)))throw new Error('Cross-folder rename refused');
  if(!move) {
    if(process.platform==='win32') {
      const kernel=koffi.load('kernel32.dll');
      const rename=kernel.func('__stdcall','MoveFileExW','int',['str16','str16','uint']);
      const lastError=kernel.func('__stdcall','GetLastError','uint',[]);
      move=(from,to)=>{if(!rename(toNamespacedPath(from),toNamespacedPath(to),0))throw new Error(`Rename refused (Windows ${lastError()})`);};
    }else if(process.platform==='linux') {
      const libc=koffi.load('libc.so.6'),rename=libc.func('int renameat2(int, const char *, int, const char *, unsigned int)');
      move=(from,to)=>{if(rename(-100,from,-100,to,1)!==0)throw new Error(`Rename refused (errno ${koffi.errno()})`);};
    }else throw new Error('Atomic no-replace rename is unavailable on this platform');
  }
  move(src,dst);
}
