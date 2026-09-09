import type { ItemsQuery, Library, LibraryListEntry, Item, NfoExplanation, UpdateLibraryRequest } from 'shared';
import type { Env } from '../../config/env.js';
import type { Settings } from '../../config/settings.js';
import { offLoop, workerModule } from '../fs/off-loop.js';

export class ScannerClient {
  private scans = offLoop(workerModule('./scanner.js', import.meta.url), { concurrency: 1, timeoutMs: 300_000 });
  private reads = offLoop(workerModule('./scanner.js', import.meta.url), { concurrency: 2 });
  constructor(private env: Env, private settings: () => Settings, private changed: () => void = () => {}) {}
  private input(action: string, fields: object = {}) { return { action, configDir: this.env.config_dir, mediaRoot: this.env.media_root, ...fields }; }
  async detect() {
    const libraries = await this.scans.run<Library[]>(this.input('detect'));
    this.changed();
    return libraries;
  }
  scan(name: string) { return this.scans.run<number>(this.input('scan', { name })); }
  async libraries(): Promise<LibraryListEntry[]> {
    const rows = await this.reads.run<Library[]>(this.input('libraries'));
    return rows.map(row => ({ ...row, effective_metadata_source: row.metadata_source ?? this.settings().metadata_source }));
  }
  async update(name: string, update: UpdateLibraryRequest) {
    const library = await this.reads.run<Library>(this.input('update', { name, update }));
    this.changed();
    return { ok: true as const, library, effective_metadata_source: library.metadata_source ?? this.settings().metadata_source };
  }
  items(query: ItemsQuery = {}) { return this.reads.run<Item[]>(this.input('items', { query })); }
  explain(path: string) { return this.reads.run<NfoExplanation>(this.input('explain', { path })); }
  async close() { await Promise.all([this.scans.close(), this.reads.close()]); }
}
