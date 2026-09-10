import { fork, type ChildProcess } from 'node:child_process';
import { watch, type FSWatcher } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isWithin } from '../../config/paths.js';
import { videoPattern } from '../scanner/layout.js';

interface WatchRoot { library: string; path: string }
type Message = { type: 'ready' } | { type: 'event'; id: number; library: string; path: string } |
  { type: 'error'; id: number; message: string } | { type: 'lost-root'; id: number; path: string; message: string } |
  { type: 'replaced'; id: number; paths: string[] };

export class ObserverClient {
  private child?: ChildProcess;
  private ready?: Promise<void>;
  private generation = 0;
  private closed = false;
  private closing?: Promise<void>;
  private paths: string[] = [];
  private pending?: { id: number; resolve: (paths: string[]) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
  constructor(private onEvent: (library: string, path: string) => void, private onError: (message: string) => void) {}
  get watchedPaths(): string[] { return [...this.paths]; }

  private start() {
    if (this.ready) return this.ready;
    const child = fork(fileURLToPath(import.meta.url), ['--observer-child'], {
      execArgv: import.meta.url.endsWith('.ts') ? ['--import', 'tsx'] : [],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    this.child = child;
    let stderr = '', failed = false;
    child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
    this.ready = new Promise<void>((resolveReady, rejectReady) => {
      const timer = setTimeout(() => fail(new Error('Observer startup timed out')), 30000);
      const fail = (error: Error) => {
        if (failed) return;
        failed = true; clearTimeout(timer); rejectReady(error);
        if (this.child === child) this.paths = [];
        if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; }
        if (!this.closed) this.onError(error.message);
        child.kill();
      };
      child.on('error', fail);
      child.on('exit', (code, signal) => {
        fail(new Error(`Observer exited (${signal ?? code})${stderr ? ': ' + stderr : ''}`));
        if (this.child === child) { this.child = undefined; this.ready = undefined; }
      });
      child.on('message', (message: Message) => {
        if (message.type === 'ready') { clearTimeout(timer); resolveReady(); return; }
        if (this.closed || message.id !== this.generation) return;
        if (message.type === 'event') this.onEvent(message.library, message.path);
        else if (message.type === 'error') this.onError(message.message);
        else if (message.type === 'lost-root') { this.paths = this.paths.filter(path => path !== message.path); this.onError(message.message); }
        else if (message.type === 'replaced' && this.pending?.id === message.id) {
          this.paths = [...message.paths]; clearTimeout(this.pending.timer); this.pending.resolve(message.paths); this.pending = undefined;
        }
      });
    });
    return this.ready;
  }

  async replace(paths: WatchRoot[]): Promise<string[]> {
    if (this.closed) throw new Error('Observer closed');
    const id = ++this.generation;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.resolve([]); this.pending = undefined; }
    if (!paths.length && !this.child) return [];
    try { await this.start(); } catch (error) { if (this.closed || id !== this.generation) return []; throw error; }
    if (id !== this.generation || this.closed) return [];
    return new Promise<string[]>((resolvePaths, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.id !== id) return;
        this.pending = undefined; reject(new Error('Observer registration timed out')); this.child?.kill();
      }, 30000);
      this.pending = { id, resolve: resolvePaths, reject, timer };
      this.child!.send({ type: 'replace', id, paths }, error => {
        if (error && this.pending?.id === id) { clearTimeout(timer); this.pending = undefined; reject(error); this.onError(error.message); }
      });
    });
  }

  async close() {
    if (this.closing) return this.closing;
    this.closed = true; this.generation++; this.paths = [];
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.resolve([]); this.pending = undefined; }
    const child = this.child;
    if (!child) return;
    this.closing = new Promise<void>(resolveClosed => {
      const timer = setTimeout(() => child.kill(), 1000);
      child.once('exit', () => { clearTimeout(timer); resolveClosed(); });
      if (child.connected) child.send({ type: 'close' }, error => { if (error) child.kill(); });
      else child.kill();
    });
    return this.closing;
  }
}

// Only the dedicated process enters this branch; importing the client never registers fs.watch.
if (process.argv[2] === '--observer-child' && process.send) {
  let generation = 0;
  const handles = new Set<FSWatcher>();
  const send = (message: Message) => { if (process.connected) process.send?.(message, () => {}); };
  const close = () => { generation++; for (const handle of handles) handle.close(); handles.clear(); };
  process.on('disconnect', close);
  process.on('message', (message: { type: 'close' } | { type: 'replace'; id: number; paths: WatchRoot[] }) => {
    if (message.type === 'close') { close(); process.disconnect(); return; }
    close(); generation = message.id;
    void (async () => {
      const paths: string[] = [];
      for (const supplied of message.paths) {
        try {
          const info = await lstat(supplied.path), root = await realpath(supplied.path);
          if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Expected a real library directory');
          if (message.id !== generation) return;
          const handle = watch(root, { recursive: true }, (event, filename) => {
            const name = filename?.toString();
            if (!name || name.split(/[\\/]/).some(part => part.startsWith('.') || /\.(tmp|temp|part)$/i.test(part))) return;
            const path = resolve(root, name);
            if (!isWithin(root, path)) return;
            void (async () => {
              const stat = await lstat(path);
              if (stat.isSymbolicLink() || !(stat.isFile() && videoPattern.test(path) || stat.isDirectory() && event === 'rename')) return;
              const canonical = await realpath(path);
              if (message.id === generation && handles.has(handle) && !relative(path, canonical) && isWithin(root, canonical)) send({ type: 'event', id: message.id, library: supplied.library, path: canonical });
            })().catch(error => {
              if (message.id === generation && (error as NodeJS.ErrnoException).code !== 'ENOENT') send({ type: 'error', id: message.id, message: `Cannot inspect watcher event ${path}: ${(error as Error).message}` });
            });
          });
          handle.on('error', error => {
            handle.close(); handles.delete(handle);
            const index = paths.indexOf(root); if (index >= 0) paths.splice(index, 1);
            if (message.id === generation) send({ type: 'lost-root', id: message.id, path: root, message: `Cannot watch ${root}: ${error.message}` });
          });
          handles.add(handle); paths.push(root);
        } catch (error) { if (message.id === generation) send({ type: 'error', id: message.id, message: `Cannot watch ${supplied.path}: ${(error as Error).message}` }); }
      }
      if (message.id === generation) send({ type: 'replaced', id: message.id, paths });
    })().catch(error => send({ type: 'error', id: message.id, message: (error as Error).message }));
  });
  send({ type: 'ready' });
}
