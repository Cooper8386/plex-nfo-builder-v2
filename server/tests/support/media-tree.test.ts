import { access, readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { layouts, mediaTree, providerDouble, withSandbox } from './index.js';

test('media-tree creates all layouts and removes the sandbox, including on failure', async () => {
  for (let run = 0; run < 2; run++) {
    let root = '';
    await withSandbox(async box => {
      root = box.root;
      for (const layout of Object.keys(layouts) as (keyof typeof layouts)[]) {
        for (const file of await mediaTree(box.media, layout)) {
          expect(await readFile(file, 'utf8')).toContain(file.endsWith('.nfo') ? '<tvshow>' : 'fixture video');
        }
      }
    });
    await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' });
  }
  let failedRoot = '';
  await expect(withSandbox(async box => { failedRoot = box.root; throw new Error('test failure'); })).rejects.toThrow('test failure');
  await expect(access(failedRoot)).rejects.toMatchObject({ code: 'ENOENT' });
});

test.each(['tvdb', 'tmdb', 'fanart'] as const)('media-tree provider double: %s canned, rate limited, and hanging requests', async provider => {
  const server = await providerDouble(provider, { 'GET /search?q=show': { results: [{ id: 1 }] } });
  try {
    expect(await (await fetch(`${server.url}/search?q=show`)).json()).toEqual({ results: [{ id: 1 }] });
    server.setMode('rate-limit');
    const response = await fetch(server.url);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('1');
    server.setMode('hang');
    await expect(fetch(server.url, { signal: AbortSignal.timeout(100) })).rejects.toThrow();
    expect(server.peakInFlight).toBeGreaterThanOrEqual(1);
  } finally { await server.close(); }
});
