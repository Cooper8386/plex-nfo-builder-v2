import { join } from 'node:path';
import { expect, test } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { writeTree } from '../../../tests/support/media-tree.js';
import { classifyStatus } from './status.js';
import { createApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';

const ours = '<!-- plex-nfo-builder -->\n<episode />';
test.each(['none', 'partial', 'complete', 'foreign', 'mixed'] as const)('status %s agrees across scan and explanation for root videos', async status => withSandbox(async box => {
  const files: Record<string, string> = { 'TV/Show/Show.S01E01.mkv': '', 'TV/Show/Show.S01E02.mkv': '' };
  if (status !== 'none') files['TV/Show/tvshow.nfo'] = status === 'foreign' ? '<tvshow />' : ours;
  if (['complete', 'foreign', 'mixed'].includes(status)) {
    files['TV/Show/Show.S01E01.nfo'] = status === 'foreign' ? '<episode />' : ours;
    files['TV/Show/Show.S01E02.nfo'] = status === 'complete' ? ours : '<episode />';
  }
  await writeTree(box.media, files);
  const app = createApp({ logger: false, env: loadEnv({ API_TOKEN: 'test', CONFIG_DIR: box.config, MEDIA_ROOT: box.media }) });
  const headers = { 'x-api-token': 'test' };
  try {
    await app.inject({ method: 'POST', url: '/api/libraries/detect', headers });
    await app.scanner.scan('TV');
    const list = await app.inject({ url: '/api/items', headers });
    const explanation = await app.inject({ url: `/api/items/nfo-explain?path=${encodeURIComponent(join(box.media, 'TV/Show'))}`, headers });
    expect(list.statusCode).toBe(200);
    expect(explanation.statusCode).toBe(200);
    expect(list.json().items[0].nfo_status).toBe(status);
    expect(explanation.json().status).toBe(status);
    expect(explanation.json().video_count).toBe(2);
    expect(explanation.json().orphan_count).toBe(0);
  } finally { await app.close(); }
}));

test('status covers season directories, missing companions, movies, and bounded provenance reads', async () => withSandbox(async box => {
  await writeTree(box.media, {
    'Show/tvshow.nfo': ours, 'Show/Season 01/a.mkv': '', 'Show/Season 01/a.nfo': ours,
    'Show/Season 01/b.mp4': '', 'Movie/a.mkv': '', 'Movie/a.nfo': ours,
    'Empty/movie.nfo': ours, 'Late/movie.nfo': ' '.repeat(2100) + ours,
  });
  const show = await classifyStatus(join(box.media, 'Show'), 'series');
  expect(show.status).toBe('partial');
  expect(show.missing).toEqual([join(box.media, 'Show/Season 01/b.nfo')]);
  expect(show.seasons[1]?.season).toBe(1);
  expect((await classifyStatus(join(box.media, 'Movie'), 'movie')).status).toBe('complete');
  expect((await classifyStatus(join(box.media, 'Empty'), 'movie')).status).toBe('complete');
  expect((await classifyStatus(join(box.media, 'Late'), 'movie')).status).toBe('foreign');
}));
