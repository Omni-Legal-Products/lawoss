/**
 * Brány zápisu do pamäte.
 *
 * Pravidlá, ktoré nejde obísť promptom, lebo nie sú v prompte:
 *
 *  1. ATOMICITA PRAVDY — zmena sekcie „Truth" musí v tom istom zápise
 *     pridať riadok do „History". Zmena pravdy bez stopy je nemožná.
 *  2. HUMAN GATE — do L1 a L3 a pri mazaní kdekoľvek zapíše iba človek.
 *     Agent smie navrhnúť (planWrite), nesmie vykonať (authorize zlyhá).
 *  3. PRAMEŇ (N5) — `authority` bez source/verified_via/verified_at sa do
 *     L3 nezapíše (assertHasSource zlyhá). Nie je to schválenie, je to
 *     kvalita dát — beží popri authorize, nie namiesto neho.
 *
 * planWrite, authorize aj assertHasSource sú čisté funkcie — nesiahajú na disk.
 */

import { canonicalValue, type OkfRecord, type TimelineEntry } from "./record.ts";
import type { Layer } from "./schema.ts";
import { checkL3Sources } from "./validate.ts";

export class TimelineIntegrityError extends Error {}
export class ApprovalRequiredError extends Error {}
export class StaleUpdatedError extends Error {}
export class L3SourceMissingError extends Error {}

export interface Approval {
  readonly by: string;
  readonly at: string;
}

export type WriteKind = "create" | "update" | "delete";

export interface WriteDiff {
  readonly kind: WriteKind;
  readonly id: string;
  readonly layer: Layer;
  readonly reason: string;
  readonly requiresApproval: boolean;
  readonly before: OkfRecord | undefined;
  readonly after: OkfRecord | undefined;
  readonly lines: readonly string[];
}

function changedFields(before: OkfRecord, after: OkfRecord): string[] {
  const previous = new Map(Object.entries(before));
  const next = new Map(Object.entries(after));
  return [...new Set([...previous.keys(), ...next.keys()])].filter((key) =>
    key !== "truth_digest" && key !== "timeline" &&
    canonicalValue(previous.get(key)) !== canonicalValue(next.get(key)));
}

function contentChanged(before: OkfRecord, after: OkfRecord): boolean {
  return changedFields(before, after).some((key) => key !== "updated");
}

function sameEntry(a: TimelineEntry | undefined, b: TimelineEntry | undefined): boolean {
  // Druh sa porovnáva tiež — bez toho by šlo ticho prepísať, čím udalosť
  // bola, a append-only záruka by tam mala dieru.
  return a !== undefined && b !== undefined &&
    a.date === b.date && a.text === b.text && a.kind === b.kind;
}

/** História je append-only: stará musí byť doslovnou predponou novej. */
function assertAppendOnly(before: OkfRecord, after: OkfRecord): void {
  if (after.timeline.length < before.timeline.length) {
    throw new TimelineIntegrityError(
      `História záznamu ${before.id} sa nesmie skracovať (${before.timeline.length} → ${after.timeline.length})`,
    );
  }
  for (let i = 0; i < before.timeline.length; i++) {
    if (!sameEntry(before.timeline[i], after.timeline[i])) {
      throw new TimelineIntegrityError(
        `História záznamu ${before.id} sa nesmie prepisovať — riadok ${i + 1} sa zmenil`,
      );
    }
  }
}

/**
 * Zmena obsahu si vyžaduje posun `updated`. Bez neho sa zvonku nedá poznať,
 * že sa záznam zmenil — a projekcia ani drift check nemajú podľa čoho ísť.
 * Doteraz to chytal až `STALE_UPDATED` vo validácii, teda po zápise (N8).
 */
function assertUpdatedBumped(
  before: OkfRecord,
  after: OkfRecord,
  today: string = new Date().toISOString().slice(0, 10),
): void {
  const obsahSaZmenil =
    contentChanged(before, after) || after.timeline.length > before.timeline.length;
  if (!obsahSaZmenil) return;
  if (after.updated > before.updated) return;
  // Rovnaké `updated` je v poriadku vtedy, keď už nesie dnešok: zmena sa deje
  // dnes a dátum ju opisuje verne. Bez tejto výnimky sa záznam nedá zmeniť
  // druhýkrát v ten istý deň — pri schválenom zápise mu CLI opečiatkuje
  // `updated` dňom schválenia, takže druhá zmena už nemá čo posunúť.
  if (after.updated === before.updated && after.updated === today) return;
  throw new StaleUpdatedError(
    `Záznam ${before.id}: zmena obsahu musí posunúť updated (teraz ${before.updated})`,
  );
}

/** Zmena pravdy alebo vecných metadát musí zanechať stopu v histórii. */
function assertTruthTraced(before: OkfRecord, after: OkfRecord): void {
  if (!contentChanged(before, after)) return;
  if (after.timeline.length === before.timeline.length) {
    throw new TimelineIntegrityError(
      `Záznam ${before.id}: zmena sekcie „Truth" alebo metadát musí pridať riadok do „History" v tom istom zápise`,
    );
  }
}

function describe(before: OkfRecord | undefined, after: OkfRecord | undefined): string[] {
  const lines: string[] = [];
  if (!before && after) {
    lines.push(`+ nový záznam ${after.id} (${after.type}, ${after.layer})`);
    lines.push(`+ Truth: ${after.truth}`);
    for (const e of after.timeline) lines.push(`+ History: ${e.date} — ${e.text}`);
    return lines;
  }
  if (before && !after) {
    lines.push(`- zmazanie záznamu ${before.id} (${before.type}, ${before.layer})`);
    return lines;
  }
  if (!before || !after) return lines;
  if (before.truth !== after.truth) {
    lines.push(`~ Truth: ${before.truth}`);
    lines.push(`~ Truth → ${after.truth}`);
  }
  const previous = new Map(Object.entries(before));
  const next = new Map(Object.entries(after));
  for (const key of changedFields(before, after)) {
    if (key === "truth") continue;
    lines.push(`~ ${key}: ${canonicalValue(previous.get(key)) ?? "∅"} → ${canonicalValue(next.get(key)) ?? "∅"}`);
  }
  for (const e of after.timeline.slice(before.timeline.length)) {
    lines.push(`+ History: ${e.date} — ${e.text}`);
  }
  return lines;
}

/**
 * Zostaví návrh zápisu. Nezapisuje — vracia diff na schválenie.
 * `after === undefined` znamená zmazanie, `before === undefined` založenie.
 */
export function planWrite(
  before: OkfRecord | undefined,
  after: OkfRecord | undefined,
  reason: string,
): WriteDiff {
  if (reason.trim() === "") {
    throw new Error("Zápis do pamäte musí niesť dôvod — bez neho sa nedá revidovať");
  }
  if (!before && !after) throw new Error("Prázdny zápis: chýba pôvodný aj nový stav");

  if (before && after) {
    if (before.id !== after.id) {
      throw new Error(`Zápis nesmie meniť id záznamu (${before.id} → ${after.id})`);
    }
    assertAppendOnly(before, after);
    assertTruthTraced(before, after);
    assertUpdatedBumped(before, after);
  }

  const kind: WriteKind = !before ? "create" : !after ? "delete" : "update";
  const subject = after ?? before;
  if (!subject) throw new Error("Prázdny zápis");
  const layer = subject.layer;
  const requiresApproval = kind === "delete" || layer === "L1" || layer === "L3";

  return {
    kind,
    id: subject.id,
    layer,
    reason: reason.trim(),
    requiresApproval,
    before,
    after,
    lines: describe(before, after),
  };
}

/**
 * Brána. Vyhodí výnimku, ak zápis potrebuje človeka a schválenie chýba.
 * Volá sa vždy pred dotykom disku.
 */
/** Čas schválenia musí byť čas — inak sa audit stopa nedá zaradiť do času. */
function isTimestamp(value: string): boolean {
  return value.trim() !== "" && !Number.isNaN(Date.parse(value));
}

export function authorize(diff: WriteDiff, approval: Approval | undefined): void {
  if (!diff.requiresApproval) return;
  if (approval && approval.by.trim() !== "" && isTimestamp(approval.at)) return;
  const why =
    diff.kind === "delete"
      ? "mazanie záznamu"
      : `zápis do vrstvy ${diff.layer}`;
  throw new ApprovalRequiredError(
    `${why} (${diff.id}) vyžaduje schválenie človekom — agent smie iba navrhnúť`,
  );
}

/**
 * Brána N5. `authority` bez `source` / `verified_via` / `verified_at` sa do
 * L3 nezapíše — nie je to schválenie (to rieši `authorize`), ale kvalita
 * dát: navigačný nález nie je prameň, kým sa nedoverí v primárnom prameni.
 * Rovnaká kontrola beží aj vo `validate` (`checkL3Sources`), aby zápis
 * a validácia nemohli tichým behom rozísť.
 */
export function assertHasSource(after: OkfRecord | undefined): void {
  if (!after || after.type !== "authority") return;
  const chyby = checkL3Sources([after]).filter((f) => f.code === "L3_SOURCE_MISSING");
  if (chyby.length === 0) return;
  throw new L3SourceMissingError(chyby.map((f) => `${f.code}: ${f.message}`).join(" "));
}
