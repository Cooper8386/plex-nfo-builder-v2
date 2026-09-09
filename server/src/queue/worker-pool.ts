import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

interface Pending { id: string; input: unknown; resolve: (value: unknown) => void; reject: (error: Error) => void }
interface Slot { child: ChildProcess; ready: boolean; stopping?: boolean; task?: Pending; timer?: NodeJS.Timeout }

/** Modules are application-owned code, never a path supplied by an API caller. */
export class WorkerPool {
  private slots = new Set<Slot>();
  private pending: Pending[] = [];
  private closed = false;
  constructor(private module: URL, readonly concurrency = 2, private timeoutMs = 30_000, private maxPending = 1000) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || timeoutMs < 1) throw new Error('Invalid worker limits');
  }

  run<T>(input: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Worker pool closed'));
    if (this.pending.length >= this.maxPending) return Promise.reject(new Error('Worker queue is full'));
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ id: randomUUID(), input, resolve: value => resolve(value as T), reject });
      this.dispatch();
    });
  }

  private spawn() {
    const development = import.meta.url.endsWith('.ts');
    const runtime = new URL(`./worker-runtime.${development ? 'ts' : 'js'}`, import.meta.url);
    const child = fork(fileURLToPath(runtime), [this.module.href], {
      execArgv: development ? ['--import', 'tsx'] : [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    const slot: Slot = { child, ready: false };
    this.slots.add(slot);
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
    slot.timer = setTimeout(() => { child.kill(); }, this.timeoutMs);
    child.on('message', (message: { ready?: string; id?: string; result?: unknown; error?: string }) => {
      if (message.ready) { clearTimeout(slot.timer); slot.ready = true; this.dispatch(); return; }
      if (!slot.task || message.id !== slot.task.id) return;
      clearTimeout(slot.timer);
      const task = slot.task;
      slot.task = undefined;
      if (message.error !== undefined) task.reject(new Error(message.error)); else task.resolve(message.result);
      this.dispatch();
    });
    child.on('error', error => { slot.task?.reject(error); slot.task = undefined; child.kill(); });
    child.on('exit', (code, signal) => {
      clearTimeout(slot.timer);
      slot.task?.reject(new Error(`Worker exited (${signal ?? code}): ${stderr}`));
      this.slots.delete(slot);
      // A worker that cannot start must not cause an endless respawn loop.
      if (!slot.ready) {
        for (const task of this.pending.splice(0)) task.reject(new Error(`Worker failed to start: ${stderr || signal || code}`));
      }
      this.dispatch();
    });
    return slot;
  }

  private dispatch() {
    if (this.closed) return;
    for (const slot of this.slots) {
      if (!slot.ready || slot.stopping || slot.task || !this.pending.length) continue;
      const task = this.pending.shift()!;
      slot.task = task;
      slot.timer = setTimeout(() => {
        task.reject(new Error(`Worker task timed out after ${this.timeoutMs}ms`));
        // Keep this slot occupied until the process exits; never grow past the cap.
        slot.stopping = true;
        slot.child.kill();
      }, this.timeoutMs);
      slot.child.send({ id: task.id, input: task.input });
    }
    if (this.pending.length && this.slots.size < this.concurrency) {
      this.spawn();
      this.dispatch();
    }
  }

  async close() {
    this.closed = true;
    for (const task of this.pending.splice(0)) task.reject(new Error('Worker pool closed'));
    await Promise.all([...this.slots].map(slot => new Promise<void>(resolve => {
      clearTimeout(slot.timer);
      slot.task?.reject(new Error('Worker pool closed'));
      slot.child.once('exit', () => resolve());
      slot.child.kill();
    })));
  }
}
