/**
 * LAWOSS: opakované čítanie DB enginu po prechodnej chybe SQLite.
 *
 * Na Windows zlyhalo pri štarte (migrácia uložených povolení po zastavení enginu) druhé otvorenie
 * DB enginu len na čítanie s `SQLITE_IOERR_TRUNCATE`, hoci prvé o chvíľu skôr prešlo (CI lawoss#397,
 * windows-2022 aj windows-11-arm). Prvé spojenie po zatvorení môže ešte krátko držať súbor `-shm`
 * a ďalšie spojenie ho ako prvé otvárajúce nevie skrátiť. Pomôcka preto zopakuje celé čítanie pri
 * prechodných triedach chýb (I/O, BUSY, LOCKED, READONLY_CANTINIT), kým neuplynie limit. Iné chyby
 * a chyba po limite sa vrátia pôvodné, nič sa neprehĺta.
 */

export const ENGINE_DB_READ_RETRY_DEADLINE_MS = 5_000;
const RETRY_DELAYS_MS = [50, 100, 200, 400, 800] as const;

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_IOERR = 10;
const SQLITE_READONLY_CANTINIT = 1288;

type Options = { deadlineMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> };

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Rozšírený kód SQLite z chyby bun:sqlite (`errno`) alebo node:sqlite (`errcode`). */
function sqliteCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  for (const key of ["errno", "errcode"]) {
    const value: unknown = Reflect.get(error, key);
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  }
  return undefined;
}

/** Chyba, ktorá môže zmiznúť, keď iné spojenie uvoľní súbory DB. */
export function isTransientSqliteError(error: unknown): boolean {
  const code = sqliteCode(error);
  if (code === undefined) return false;
  const primary = code & 0xff;
  return primary === SQLITE_BUSY || primary === SQLITE_LOCKED || primary === SQLITE_IOERR || code === SQLITE_READONLY_CANTINIT;
}

/** Vykoná celé čítanie; pri prechodnej chybe SQLite ho zopakuje do limitu. */
export async function readEngineDbWithRetry<T>(read: () => Promise<T>, options: Options = {}): Promise<T> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = now() + (options.deadlineMs ?? ENGINE_DB_READ_RETRY_DEADLINE_MS);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      if (!isTransientSqliteError(error) || now() + delay > deadline) throw error;
      await sleep(delay);
    }
  }
}
