import { WorkerPool } from '../../queue/worker-pool.js';

/** Separate pools isolate request reads from long-running media jobs. */
export function offLoop(module: URL, options: { concurrency?: number; timeoutMs?: number; maxPending?: number } = {}) {
  return new WorkerPool(module, options.concurrency ?? 2, options.timeoutMs ?? 30_000, options.maxPending ?? 1000);
}

export function workerModule(relativePath: string, parent: string) {
  return new URL(relativePath.replace(/\.js$/, parent.endsWith('.ts') ? '.ts' : '.js'), parent);
}
