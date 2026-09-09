import Database from 'better-sqlite3';
import { mkdir } from 'node:fs/promises';
import { configPaths } from '../config/paths.js';
import { migrate } from './schema.js';

export async function openDatabase(configDir: string) {
  const paths = configPaths(configDir);
  await mkdir(paths.root, { recursive: true });
  const db = new Database(paths.database);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    migrate(db);
    return db;
  } catch (error) { db.close(); throw error; }
}
