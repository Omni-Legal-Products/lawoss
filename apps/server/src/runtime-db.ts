import { RuntimeDbInitializationError } from "./runtime-db-lifecycle.js";
/**
 * runtime.sqlite, the machine's own store beside the server config: the
 * statements its stores need, over bun:sqlite (bun) or node:sqlite (Node /
 * Electron) — better-sqlite3 is not loadable under bun.
 */

export type SqlValue = string | number | null;
export type Row = Record<string, unknown>;

export type SqliteHandle = {
  close: () => void;
  prepare: (sql: string) => {
    run: (...params: SqlValue[]) => { changes: number | bigint };
    get: (...params: SqlValue[]) => Row | undefined;
  };
  run: (sql: string, params?: SqlValue[]) => void;
  all: (sql: string, params?: SqlValue[]) => Row[];
  get: (sql: string, params?: SqlValue[]) => Row | undefined;
  exec: (sql: string) => void;
};

export async function openSqlite(path: string): Promise<SqliteHandle> {
  if (typeof process.versions.bun === "string") {
    const { Database } = await import("bun:sqlite");
    const db = new Database(path, { create: true });
    let closed = false;
    return {
      close: () => { if (!closed) { db.close(true); closed = true; } },
      // Bun finalizes cached query statements on close; uncached prepare statements
      // otherwise keep sqlite3_close_v2 handles alive until garbage collection.
      prepare: (sql) => {
        const statement = db.query(sql);
        return {
          run: (...params) => statement.run(...params),
          get: (...params) => (statement.get(...params) as Row | null) ?? undefined,
        };
      },
      run: (sql, params = []) => {
        db.query(sql).run(...params);
      },
      all: (sql, params = []) => db.query(sql).all(...params) as Row[],
      get: (sql, params = []) => (db.query(sql).get(...params) as Row | null) ?? undefined,
      exec: (sql) => {
        db.exec(sql);
      },
    };
  }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path);
  let closed = false;
  return {
    close: () => { if (!closed) { db.close(); closed = true; } },
    prepare: (sql) => db.prepare(sql),
    run: (sql, params = []) => {
      db.prepare(sql).run(...params);
    },
    all: (sql, params = []) => db.prepare(sql).all(...params) as Row[],
    get: (sql, params = []) => db.prepare(sql).get(...params) as Row | undefined,
    exec: (sql) => {
      db.exec(sql);
    },
  };
}

export { runtimeDbPath } from "./runtime-db-lifecycle.js";


/** Close partial initialization without discarding either failure or its real native handle. */
export async function initializeSqlite<T>(path: string, initialize: (db: SqliteHandle) => T | Promise<T>): Promise<T> {
  const db = await openSqlite(path);
  try { return await initialize(db); }
  catch (initializationError) {
    try { db.close(); }
    catch (cleanupError) {
      let retry: Promise<void> | undefined;
      throw new RuntimeDbInitializationError([initializationError, cleanupError], db, () => {
        retry ??= Promise.resolve().then(() => db.close()).catch(error => { retry = undefined; throw error; });
        return retry;
      });
    }
    throw initializationError;
  }
}
