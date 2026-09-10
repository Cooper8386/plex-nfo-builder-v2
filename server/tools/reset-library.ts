import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { applyReset, previewReset } from '../src/services/cleaner/files.js';
export { applyReset, previewReset, type Candidate, type ResetPlan } from '../src/services/cleaner/files.js';

export async function runResetCli(args: string[]) {
  const { values } = parseArgs({ args, options: { 'media-root': { type: 'string' }, confirm: { type: 'boolean', default: false }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('Usage: pnpm reset-library --media-root <path> [--confirm]\nDry-run by default. At cutover only: --confirm deletes all NFOs, sidecars, and standard artwork.');
    return;
  }
  const root = values['media-root'] || process.env.MEDIA_ROOT;
  if (!root) throw new Error('Specify --media-root or MEDIA_ROOT');
  const plan = await previewReset(root);
  console.log(`Reset preview: ${plan.root}`);
  for (const type of ['sidecar', 'nfo', 'artwork', 'thumbnail', 'actors'] as const) {
    const files = plan.files.filter(f => f.type === type);
    console.log(`${type}: ${files.length}`);
    for (const file of files) console.log(`  ${file.path}`);
  }
  for (const item of plan.skipped) console.error(`Skipped ${item.path}: ${item.reason}`);
  if (values.confirm) {
    const result = await applyReset(plan, true);
    console.log(`Removed: ${result.removed.length}; skipped: ${result.skipped.length}`);
    for (const item of result.skipped.slice(plan.skipped.length)) console.error(`Skipped ${item.path}: ${item.reason}`);
    if (result.skipped.length) process.exitCode = 1;
  } else console.log('Dry-run only. No files deleted. Pass --confirm to delete at cutover.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runResetCli(process.argv.slice(2)).catch(error => { console.error((error as Error).message); process.exitCode = 1; });
}
