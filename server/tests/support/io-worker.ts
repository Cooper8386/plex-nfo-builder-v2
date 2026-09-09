import { readFileSync } from 'node:fs';
import type { StoredJob } from '../../src/queue/jobs-table.js';

export async function handle(input: StoredJob | { action: string; path?: string }) {
  if ('action' in input) {
    if (input.action === 'hang') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    if (input.action === 'read') return readFileSync(input.path!, 'utf8');
    return 'ready';
  }
  const payload = input.payload as { url?: string; fail?: string };
  if (payload.fail) throw new Error(payload.fail);
  if (payload.url) {
    const response = await fetch(payload.url);
    if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
    await response.text();
  }
  return null;
}
