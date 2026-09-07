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
import { parseFrontmatter, type FmValue } from "./record.ts";
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

function readConfig(
  officeDir: string | undefined,
): Map<string, FmValue> | undefined {
  if (!officeDir) return undefined;
  const path = join(officeDir, CONFIG_FILE);
  if (!existsSync(path)) return undefined;
  return parseFrontmatter(readFileSync(path, "utf8"));
}

/**
 * Kde v strome leží priečinok klienta, keď v ňom nie je karta.
 *
 * Vaulty, ktoré vznikli pred OKF, majú klientov usporiadaných podľa vlastnej
 * logiky (`AK/R/Novák Ján/…`) a karta v nich nie je. Rozsypať do nich 52
 * súborov `klient.md` len preto, aby ich nástroj spoznal, je zásah do cudzieho
 * poriadku. Vzor sa preto zapíše raz do konfigu.
 *
 * Hviezdička zastupuje **jeden segment cesty**, nie ľubovoľnú hĺbku — vzor
 * `AK/*` + `/*` by inak označil za klienta aj priečinok veci.
 */
export function readClientPath(officeDir: string | undefined): string | undefined {
  const v = readConfig(officeDir)?.get("client_path");
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** Sedí relatívna cesta na vzor, kde `*` je práve jeden segment? */
export function matchesClientPath(relative: string, pattern: string): boolean {
  const seg = relative.split("/").filter((x) => x !== "");
  const pat = pattern.split("/").filter((x) => x !== "");
  if (seg.length !== pat.length) return false;
  return pat.every((p, i) => p === "*" || p === seg[i]);
}

export function readStandingAuthorization(
  officeDir: string | undefined,
): StandingAuthorization | undefined {
  const kv = readConfig(officeDir);
  if (!kv) return undefined;
  const by = text(kv.get("standing_authorization"));
  const expiresAt = text(kv.get("expires_at"));
  const reason = text(kv.get("reason"));
  const raw = kv.get("scope");
  // Vrstvy sú reťazce; mapovanie v `scope` je chyba zápisu, nie vrstva.
  const scope = Array.isArray(raw) ? (raw as unknown[]).filter((x): x is string => typeof x === "string") : [];

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
