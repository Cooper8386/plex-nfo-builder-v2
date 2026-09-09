import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), 'plex-nfo-test-'));
  const media = join(root, 'media');
  const config = join(root, 'config');
  await Promise.all([mkdir(media), mkdir(config)]);
  return { root, media, config, cleanup: () => rm(root, { recursive: true, force: true }) };
}

export async function withSandbox<T>(run: (box: Awaited<ReturnType<typeof sandbox>>) => Promise<T>) {
  const box = await sandbox();
  try { return await run(box); } finally { await box.cleanup(); }
}
