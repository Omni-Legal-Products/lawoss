/**
 * Konfigurácia kancelárie — `_kancelaria/okf.config`.
 *
 * Jediná vec, ktorú dnes nesie: **trvalé poverenie** advokáta, ktorým sa
 * ruší potvrdzovanie jednotlivých zápisov do L1 a L3. Je to vedomý akt —
 * advokát súbor napíše a podpíše sa v ňom menom, dôvodom a dátumom konca.
 *
 * Chýbajúci alebo neúplný súbor znamená „žiadne poverenie" a brána zostáva
 * zapnutá. Bezpečný default je ten, ktorý blokuje.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./record.ts";
import type { WriteDiff } from "./write.ts";

export const CONFIG_FILE = "okf.config";

export interface StandingAuthorization {
  readonly by: string;
  readonly grantedAt: string;
  readonly expiresAt: string;
  /** Vrstvy, ktorých sa poverenie týka — `L1`, `L3`. Mazanie nikdy. */
  readonly scope: readonly string[];
  readonly reason: string;
}

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function readStandingAuthorization(
  officeDir: string | undefined,
): StandingAuthorization | undefined {
  if (!officeDir) return undefined;
  const path = join(officeDir, CONFIG_FILE);
  if (!existsSync(path)) return undefined;

  const kv = parseFrontmatter(readFileSync(path, "utf8"));
  const by = text(kv.get("standing_authorization"));
  const expiresAt = text(kv.get("expires_at"));
  const reason = text(kv.get("reason"));
  const raw = kv.get("scope");
  const scope = Array.isArray(raw) ? raw : [];

  // Neúplné poverenie nie je poverenie. Bez mena sa nedá podpísať, bez konca
  // by platilo navždy a bez dôvodu sa po roku nedá posúdiť, či ešte platí.
  if (!by || !expiresAt || !reason || scope.length === 0) return undefined;
  return { by, grantedAt: text(kv.get("granted_at")), expiresAt, scope, reason };
}

export function isExpired(auth: StandingAuthorization, today: string): boolean {
  return auth.expiresAt < today;
}

/** Kryje poverenie tento zápis? Mazanie nikdy — je nezvratné. */
export function covers(
  auth: StandingAuthorization,
  diff: WriteDiff,
  today = new Date().toISOString().slice(0, 10),
): boolean {
  if (diff.kind === "delete") return false;
  if (isExpired(auth, today)) return false;
  return auth.scope.includes(diff.layer);
}
