import type Database from 'better-sqlite3';
import type { Job } from 'shared';
import { mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openDatabase } from '../db/connection.js';

export interface StoredJob extends Job { payload: unknown }
let database: Database.Database | undefined;
let config: string | undefined;
export async function handle(input: { configDir: string; action: string; job?: StoredJob; id?: string; status?: 'completed' | 'failed'; message?: string }) {
  if (!database) { database = await openDatabase(input.configDir); config = input.configDir; }
  if (config !== input.configDir) throw new Error('A database worker owns one config directory');
  const db = database;
  db.exec(`CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, folder TEXT NOT NULL, payload TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed')),
    progress INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 1,
    started_at INTEGER, finished_at INTEGER, messages TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status,created_at);`);
  const decode = (row: unknown): StoredJob | null => {
    if (!row) return null;
    const value = row as StoredJob & { payload: string; messages: string };
    return { ...value, payload: JSON.parse(value.payload), messages: JSON.parse(value.messages) };
  };
  if (input.action === 'recover') {
    return db.prepare("UPDATE jobs SET status='failed',finished_at=?,messages=? WHERE status='running'")
      .run(Date.now(), JSON.stringify(['Interrupted by restart; retry explicitly'])).changes;
  }
  if (input.action === 'enqueue') {
    const job = input.job!;
    db.prepare('INSERT INTO jobs(id,kind,folder,payload,status,created_at) VALUES (?,?,?,?,?,?)')
      .run(job.id, job.kind, job.folder, JSON.stringify(job.payload), 'queued', Date.now());
    return job.id;
  }
  if (input.action === 'claim') return db.transaction(() => {
    const row = db.prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at,rowid LIMIT 1").get() as StoredJob | undefined;
    if (!row) return null;
    db.prepare("UPDATE jobs SET status='running',started_at=? WHERE id=?").run(Date.now(), row.id);
    return decode(db.prepare('SELECT * FROM jobs WHERE id=?').get(row.id));
  })();
  if (input.action === 'finish') {
    db.prepare('UPDATE jobs SET status=?,finished_at=?,progress=?,messages=? WHERE id=?')
      .run(input.status!, Date.now(), input.status === 'completed' ? 1 : 0, JSON.stringify([input.message]), input.id!);
    return null;
  }
  if (input.action === 'get') return decode(db.prepare('SELECT * FROM jobs WHERE id=?').get(input.id!));
  if (input.action === 'list') return db.prepare('SELECT * FROM jobs ORDER BY created_at,rowid').all().map(decode);
  if (input.action === 'log') {
    if (!input.id || !/^[a-f0-9-]{36}$/.test(input.id)) throw new Error('Invalid job log id');
    const folder = join(input.configDir, 'logs', 'jobs');
    await mkdir(folder, { recursive: true });
    await appendFile(join(folder, `${input.id}.log`), `${new Date().toISOString()} ${input.message}\n`);
    return null;
  }
  throw new Error(`Unknown job action: ${input.action}`);
}
