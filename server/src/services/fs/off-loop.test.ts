import { expect, test } from 'vitest';
import { offLoop, workerModule } from './off-loop.js';
import { createApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';

test('off-loop isolates a hung filesystem worker from health and a separate I/O pool', async () => {
  const module = workerModule('../../../tests/support/io-worker.js', import.meta.url);
  const blocked = offLoop(module, { concurrency: 1, timeoutMs: 1000 });
  const reads = offLoop(module, { concurrency: 1, timeoutMs: 5000 });
  const app = createApp({ env: loadEnv({ API_TOKEN: 'test' }), logger: false });
  try {
    await blocked.run({ action: 'ready' });
    const hung = blocked.run({ action: 'hang' });
    const rejection = expect(hung).rejects.toThrow('timed out');
    const started = Date.now();
    expect((await app.inject({ url: '/api/health', headers: { 'x-api-token': 'test' } })).statusCode).toBe(200);
    expect(Date.now() - started).toBeLessThan(500);
    expect(await reads.run({ action: 'ready' })).toBe('ready');
    await rejection;
  } finally { await blocked.close(); await reads.close(); await app.close(); }
});
