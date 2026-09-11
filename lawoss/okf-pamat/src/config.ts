/**
 * Konfigurácia kancelárie — `Office/okf.config` (staršie `_kancelaria/`).
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

/** `RRRR-MM-DD` a zároveň skutočný deň — `2026-02-30` neprejde. */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export interface StandingAuthorizationCheck {
  readonly auth?: StandingAuthorization;
  /** Prečo poverenie neplatí — aby to `validate` vedelo povedať, nie len mlčky blokovať. */
  readonly problem?: string;
}

/**
 * Prečíta poverenie a povie, prečo prípadne neplatí.
 *
 * Dátumy sa doteraz porovnávali ako text. Pri `2026-12-31` to fungovalo; pri
 * `31.12.2026` vyšlo, že poverenie nikdy nevyprší — tichý omyl v neprospech
 * advokáta, ktorý si myslel, že podpísal lehotu. Preto sa dátum musí dať
 * prečítať ako dátum, inak poverenie nie je.
 */
export function inspectStandingAuthorization(
  officeDir: string | undefined,
): StandingAuthorizationCheck {
  const kv = readConfig(officeDir);
  if (!kv || !kv.has("standing_authorization")) return {};
  const by = text(kv.get("standing_authorization"));
  const expiresAt = text(kv.get("expires_at"));
  const grantedAt = text(kv.get("granted_at"));
  const reason = text(kv.get("reason"));
  const raw = kv.get("scope");
  // Vrstvy sú reťazce; mapovanie v `scope` je chyba zápisu, nie vrstva.
  const scope = Array.isArray(raw) ? (raw as unknown[]).filter((x): x is string => typeof x === "string") : [];

  // Neúplné poverenie nie je poverenie. Bez mena sa nedá podpísať, bez konca
  // by platilo navždy a bez dôvodu sa po roku nedá posúdiť, či ešte platí.
  if (!by) return { problem: "chýba standing_authorization (meno advokáta)" };
  if (!expiresAt) return { problem: "chýba expires_at" };
  if (!isIsoDate(expiresAt)) return { problem: `expires_at „${expiresAt}" nie je dátum RRRR-MM-DD` };
  if (grantedAt && !isIsoDate(grantedAt)) return { problem: `granted_at „${grantedAt}" nie je dátum RRRR-MM-DD` };
  if (grantedAt && grantedAt > expiresAt) return { problem: `granted_at ${grantedAt} je po expires_at ${expiresAt}` };
  if (!reason) return { problem: "chýba reason" };
  if (scope.length === 0) return { problem: "chýba scope (napr. [L1, L3])" };
  return { auth: { by, grantedAt, expiresAt, scope, reason } };
}

export function readStandingAuthorization(
  officeDir: string | undefined,
): StandingAuthorization | undefined {
  return inspectStandingAuthorization(officeDir).auth;
}

/** Závažnosť zhody mena v L3. Identifikátory (IČO, RČ, dátum) sa nastaviť nedajú. */
export type NameLeakSeverity = "error" | "warning";

/**
 * Politika kancelárie k zhode **mena** v prameni L3.
 *
 * `leak_name_severity: warning` zníži zhodu celého mena alebo firmy na
 * varovanie — ale iba s uvedeným `leak_name_reason`. Vypnutie bez dôvodu sa
 * ignoruje. IČO, rodné číslo a dátum narodenia sa zmäkčiť nedajú: to nie je
 * prah, to je únik.
 */
export function readNameLeakSeverity(officeDir: string | undefined): NameLeakSeverity {
  const kv = readConfig(officeDir);
  const sev = text(kv?.get("leak_name_severity"));
  const reason = text(kv?.get("leak_name_reason"));
  return sev === "warning" && reason !== "" ? "warning" : "error";
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
