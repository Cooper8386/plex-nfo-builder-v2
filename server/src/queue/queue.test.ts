import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { JobQueue } from './queue.js';
import { WorkerPool } from './worker-pool.js';
import { workerModule } from '../services/fs/off-loop.js';
import { providerDouble, withSandbox } from '../../tests/support/index.js';

const taskModule = workerModule('../../tests/support/io-worker.js', import.meta.url);

test('queue persists queued jobs, recovers interrupted jobs and records failures and logs', async () => withSandbox(async box => {
  const store = new WorkerPool(workerModule('./jobs-table.js', import.meta.url), 1);
  const interrupted = randomUUID();
  await store.run({ configDir: box.config, action: 'enqueue', job: { id: interrupted, kind: 'series', folder: box.media, payload: {} } });
  await store.run({ configDir: box.config, action: 'claim' });
  await store.close();
  let queue = new JobQueue(box.config, taskModule);
  const queued = await queue.enqueue('movie', box.media, { fail: 'Provider unavailable' });
  await queue.close();
  queue = new JobQueue(box.config, taskModule);
  try {
    expect((await queue.get(queued))?.status).toBe('queued');
    await queue.start();
    await expect.poll(async () => (await queue.get(queued))?.status).toBe('failed');
    expect((await queue.get(queued))?.messages).toEqual(['Provider unavailable']);
    expect((await queue.get(interrupted))?.messages[0]).toContain('Interrupted by restart');
    await expect.poll(async () => readFile(join(box.config, 'logs/jobs', `${queued}.log`), 'utf8')).toContain('Provider unavailable');
  } finally { await queue.close(); }
}));

test('queue runs 200 provider tasks at no more than the worker limit', async () => withSandbox(async box => {
  const provider = await providerDouble('tmdb', { 'GET /': { ok: true } });
  provider.setDelay(15);
  const queue = new JobQueue(box.config, taskModule, 3);
  try {
    for (let i = 0; i < 200; i++) await queue.enqueue('series', box.media, { url: provider.url });
    await queue.start();
    await expect.poll(async () => (await queue.list()).filter(job => job.status === 'completed').length, { timeout: 15000 }).toBe(200);
    expect(provider.requests).toHaveLength(200);
    expect(provider.peakInFlight).toBeLessThanOrEqual(3);
    expect(provider.peakInFlight).toBeGreaterThan(1);
    expect(queue.lastError).toBeNull();
  } finally { await queue.close(); await provider.close(); }
}), 20000);
