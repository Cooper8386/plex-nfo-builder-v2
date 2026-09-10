import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect,test } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { renameNoReplace } from './native-move.js';
test('renamer native move refuses an arriving destination without replacing either file',async()=>withSandbox(async box=>{
  const src=join(box.media,'源.mkv'),dst=join(box.media,'目标.mkv');await writeFile(src,'source');
  await writeFile(dst,'arrival');expect(()=>renameNoReplace(src,dst)).toThrow('Rename refused');
  expect(await readFile(src,'utf8')).toBe('source');expect(await readFile(dst,'utf8')).toBe('arrival');
  const vacant=join(box.media,'new.mkv');renameNoReplace(src,vacant);expect(await readFile(vacant,'utf8')).toBe('source');
}));
