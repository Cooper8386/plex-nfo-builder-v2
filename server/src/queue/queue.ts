import { randomUUID } from 'node:crypto';
import type { ItemKind } from 'shared';
import { WorkerPool } from './worker-pool.js';
import { workerModule } from '../services/fs/off-loop.js';
import type { StoredJob } from './jobs-table.js';

export class JobQueue {
  private database = new WorkerPool(workerModule('./jobs-table.js', import.meta.url), 1);
  private workers: WorkerPool;
  private running = new Set<Promise<void>>();
  private pumping = false;
  private wakeAgain = false;
  private stopped = true;
  lastError: Error | null = null;
  constructor(readonly configDir: string, taskModule: URL, readonly concurrency = 2, timeoutMs = 30_000, private context?: () => unknown) {
    this.workers = new WorkerPool(taskModule, concurrency, timeoutMs);
  }
  private store<T>(action: string, data: object = {}) { return this.database.run<T>({ configDir: this.configDir, action, ...data }); }
  async start() {
    await this.store('recover');
    this.stopped = false;
    this.wake();
  }
  async enqueue(kind: ItemKind, folder: string, payload: unknown = null) {
    const job = { id: randomUUID(), kind, folder, payload };
    await this.store('enqueue', { job });
    this.wake();
    return job.id;
  }
  get(id: string) { return this.store<StoredJob | null>('get', { id }); }
  list() { return this.store<StoredJob[]>('list'); }
  private wake() {
    if (this.pumping) { this.wakeAgain = true; return; }
    void this.pump().catch(error => { this.lastError = error; this.stopped = true; });
  }
  private async pump() {
    if (this.pumping || this.stopped) return;
    this.pumping = true;
    try {
      while (!this.stopped && this.running.size < this.concurrency) {
        const job = await this.store<StoredJob | null>('claim');
        if (!job) break;
        const execution = this.execute(job).catch(error => { this.lastError = error; this.stopped = true; });
        this.running.add(execution);
        void execution.finally(() => { this.running.delete(execution); this.wake(); });
      }
    } finally {
      this.pumping = false;
      if (this.wakeAgain) { this.wakeAgain = false; this.wake(); }
    }
  }
  private async execute(job: StoredJob) {
    let status: 'completed' | 'failed' = 'completed';
    let message = 'Completed';
    try {
      await this.store('log', { id: job.id, message: 'Started' });
      // Runtime credentials/settings travel only over IPC; never persist them in the job table.
      await this.workers.run({...job,context:this.context?.()});
    } catch (error) { status = 'failed'; message = error instanceof Error ? error.message : String(error); }
    await this.store('finish', { id: job.id, status, message });
    await this.store('log', { id: job.id, message });
  }
  async close() {
    this.stopped = true;
    await this.workers.close();
    while (this.pumping) await new Promise(resolve => setTimeout(resolve, 5));
    await Promise.all(this.running);
    await this.database.close();
  }
}
