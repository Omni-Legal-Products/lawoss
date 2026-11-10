import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isTransientSqliteError, readEngineDbWithRetry } from "./engine-db-read-retry.js";

// Windows CI lawoss#397: druhé otvorenie DB enginu len na čítanie zlyhalo s SQLITE_IOERR_TRUNCATE.

const clock = () => {
  let time = 0;
  return { now: () => time, sleep: async (ms: number) => { time += ms; } };
};
const sqliteError = (errno: number, code: string) => Object.assign(new Error(code), { errno, code });

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "lawoss-engine-db-retry-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("skutočná chyba bun:sqlite nesie rozšírený kód; I/O a BUSY sú prechodné, poškodenie nie", () => {
  let missing: unknown;
  try { new Database(join(root, "nie-je.db"), { readonly: true }); } catch (error) { missing = error; }
  expect(missing).toBeDefined();
  expect(typeof Reflect.get(missing as object, "errno")).toBe("number");
  expect(isTransientSqliteError(missing)).toBe(false); // SQLITE_CANTOPEN
  expect(isTransientSqliteError(sqliteError(1546, "SQLITE_IOERR_TRUNCATE"))).toBe(true);
  expect(isTransientSqliteError(sqliteError(5, "SQLITE_BUSY"))).toBe(true);
  expect(isTransientSqliteError(sqliteError(1288, "SQLITE_READONLY_CANTINIT"))).toBe(true);
  expect(isTransientSqliteError(Object.assign(new Error("node"), { code: "ERR_SQLITE_ERROR", errcode: 1546 }))).toBe(true);
  expect(isTransientSqliteError(sqliteError(11, "SQLITE_CORRUPT"))).toBe(false);
  expect(isTransientSqliteError(new Error("The existing saved-permission database has an unsupported schema"))).toBe(false);
});

test("prechodná chyba sa zopakuje a vráti sa výsledok čítania", async () => {
  let calls = 0;
  const result = await readEngineDbWithRetry(async () => {
    calls += 1;
    if (calls < 3) throw sqliteError(1546, "SQLITE_IOERR_TRUNCATE");
    return "rows";
  }, clock());
  expect(result).toBe("rows");
  expect(calls).toBe(3);
});

test("po limite sa vráti pôvodná chyba, iná chyba sa neopakuje", async () => {
  const truncate = sqliteError(1546, "SQLITE_IOERR_TRUNCATE");
  let calls = 0;
  await expect(readEngineDbWithRetry(async () => { calls += 1; throw truncate; }, { ...clock(), deadlineMs: 1_000 })).rejects.toBe(truncate);
  expect(calls).toBeGreaterThan(1);
  expect(calls).toBeLessThan(10);

  const schema = new Error("unsupported schema");
  calls = 0;
  await expect(readEngineDbWithRetry(async () => { calls += 1; throw schema; }, clock())).rejects.toBe(schema);
  expect(calls).toBe(1);
});
