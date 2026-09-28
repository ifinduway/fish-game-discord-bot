import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './migrations.js';

export type DB = Database.Database;

/** Minimal context repos need: anything with a `db` (GameContext satisfies it). */
export interface DbCtx {
  db: DB;
}

export interface OpenDatabaseOptions {
  /** run migrations after opening (default true) */
  migrate?: boolean;
}

/** Opens (and by default migrates) a SQLite database. Use ':memory:' for tests. */
export function openDatabase(path: string, opts: OpenDatabaseOptions = {}): DB {
  const inMemory = path === ':memory:' || path === '';
  if (!inMemory) mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  if (!inMemory) db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  if (opts.migrate !== false) migrate(db);
  return db;
}

const stmtCache = new WeakMap<DB, Map<string, Database.Statement>>();

/** Cached prepared statement (per db instance). */
export function prepare<P extends unknown[] | {} = unknown[], R = unknown>(db: DB, sql: string): Database.Statement<P, R> {
  let m = stmtCache.get(db);
  if (!m) {
    m = new Map();
    stmtCache.set(db, m);
  }
  let s = m.get(sql);
  if (!s) {
    s = db.prepare(sql);
    m.set(sql, s);
  }
  return s as unknown as Database.Statement<P, R>;
}

/**
 * Runs `fn` inside a transaction. Nested calls become savepoints (better-sqlite3 semantics),
 * so this is safe to call from code that may or may not already be inside a transaction.
 */
export function inTransaction<T>(db: DB, fn: () => T): T {
  return db.transaction(fn)();
}
