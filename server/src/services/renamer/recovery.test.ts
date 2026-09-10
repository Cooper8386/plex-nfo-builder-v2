import { readFile,writeFile,readdir } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test,expect,vi } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { openDatabase } from '../../db/connection.js';
import { folderSnapshot,restoreSnapshot } from '../../db/queries.js';
import { sidecarSchema } from '../sidecar/format.js';
import { applyRename } from './renamer.js';
import { renameNoReplace } from './native-move.js';
vi.mock('./native-move.js',async original=>({renameNoReplace:vi.fn((await original<typeof import('./native-move.js')>()).renameNoReplace)}));
test('renamer reports retained original and migrates its mapping when case-only rollback cannot restore',async()=>withSandbox(async box=>{
  const src=join(box.media,'SHOW.mkv'),dst=join(box.media,'show.mkv');await writeFile(src,'original');const db=await openDatabase(box.config);
  try{
    restoreSnapshot(db,box.media,sidecarSchema.parse({version:2,binding:null,episode_file_overrides:[{file_path:'SHOW.mkv',season:1,episode:1}]}));
    const real=(await vi.importActual<typeof import('./native-move.js')>('./native-move.js')).renameNoReplace;
    let calls=0;vi.mocked(renameNoReplace).mockImplementation((from,to)=>{calls++;if(calls===2){writeFileSync(dst,'arrival');throw new Error('destination arrived');}if(calls===3)throw new Error('rollback collision');real(from,to);});
    const result=await applyRename(db,box.media,[{src,dst,src_name:'SHOW.mkv',dst_name:'show.mkv',season:1,episode:1,matched_title:null,conflict:null,unchanged:false}]);
    const retained=(await readdir(box.media)).find(name=>name.startsWith('.rename-'))!;
    expect(result.failed[0]?.reason).toContain(join(box.media,retained));expect(await readFile(join(box.media,retained),'utf8')).toBe('original');expect(await readFile(dst,'utf8')).toBe('arrival');
    expect(folderSnapshot(db,box.media).episode_file_overrides[0]?.file_path).toBe(retained);
  }finally{vi.mocked(renameNoReplace).mockReset();db.close();}
}));
