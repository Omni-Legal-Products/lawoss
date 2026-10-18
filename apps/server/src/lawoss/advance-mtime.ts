import type { Stats } from "node:fs";
import { stat, utimes } from "node:fs/promises";

/**
 * Po zápise servera musí byť čas zmeny súboru novší ako pred zápisom. Windows má hrubú
 * granularitu času (približne 15 ms): dva zápisy tesne po sebe by dostali rovnaký `mtime`
 * a kontrola konfliktu podľa `baseUpdatedAt` by druhý zápis neodhalila (súbežné okná by
 * sa prepísali). Ak sa čas neposunul, nastaví sa o milisekundu za pôvodný.
 */
export async function statWithAdvancedMtime(path: string, beforeMtimeMs: number | null): Promise<Stats> {
  const after = await stat(path);
  if (beforeMtimeMs === null || after.mtimeMs > beforeMtimeMs) return after;
  await utimes(path, after.atime, new Date(Math.floor(beforeMtimeMs) + 1));
  return stat(path);
}
