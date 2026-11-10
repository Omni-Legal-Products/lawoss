/**
 * LAWOSS: atómové nahradenie súboru cez `renameSync` s krátkym opakovaním na Windows.
 *
 * Na Windows `rename` cez existujúci cieľ zlyhá s `EPERM`/`EACCES`/`EBUSY`, kým má cieľ otvorený
 * iný proces (súbežné čítanie značky, antivírus). Na CI windows-11-arm tak padol test súbežných
 * procesov v `native-config-state.test.ts` (lawoss#396). Pomôcka zopakuje premenovanie s rastúcim
 * odstupom do pevného limitu; po limite a pri iných chybách alebo platformách vráti pôvodnú chybu.
 * Je synchrónna, lebo volajúci beží vo vnútri synchrónnej transakcie.
 */

import { renameSync } from "node:fs";

export const WINDOWS_RENAME_RETRY_DEADLINE_MS = 2_000;
const RETRY_DELAYS_MS = [10, 20, 40, 80, 160] as const;
const RETRYABLE_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

type Options = {
  platform?: NodeJS.Platform;
  rename?: (from: string, to: string) => void;
  now?: () => number;
  sleep?: (ms: number) => void;
  deadlineMs?: number;
};

const sleepSync = (ms: number) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

/** `renameSync`, ktorý na Windows počká, kým iný proces pustí cieľ. */
export function renameSyncWithRetry(from: string, to: string, options: Options = {}): void {
  const rename = options.rename ?? renameSync;
  if ((options.platform ?? process.platform) !== "win32") return rename(from, to);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepSync;
  const deadline = now() + (options.deadlineMs ?? WINDOWS_RENAME_RETRY_DEADLINE_MS);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return rename(from, to);
    } catch (error) {
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      if (!RETRYABLE_CODES.has(errorCode(error) ?? "") || now() + delay > deadline) throw error;
      sleep(delay);
    }
  }
}
