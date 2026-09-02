/**
 * Brány zápisu do pamäte.
 *
 * Dve pravidlá, ktoré nejde obísť promptom, lebo nie sú v prompte:
 *
 *  1. ATOMICITA PRAVDY — zmena sekcie „Truth" musí v tom istom zápise
 *     pridať riadok do „History". Zmena pravdy bez stopy je nemožná.
 *  2. HUMAN GATE — do L1 a L3 a pri mazaní kdekoľvek zapíše iba človek.
 *     Agent smie navrhnúť (planWrite), nesmie vykonať (authorize zlyhá).
 *
 * planWrite aj authorize sú čisté funkcie — nesiahajú na disk.
 */

import type { OkfRecord, TimelineEntry } from "./record.ts";
import type { Layer } from "./schema.ts";

export class TimelineIntegrityError extends Error {}
export class ApprovalRequiredError extends Error {}
export class StaleUpdatedError extends Error {}

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
function assertUpdatedBumped(before: OkfRecord, after: OkfRecord): void {
  const obsahSaZmenil =
    before.truth !== after.truth || after.timeline.length > before.timeline.length;
  if (!obsahSaZmenil) return;
  if (after.updated !== before.updated) return;
  throw new StaleUpdatedError(
    `Záznam ${before.id}: zmena obsahu musí posunúť updated (teraz ${before.updated})`,
  );
}

/** Zmena pravdy si vyžaduje nový riadok histórie v tom istom zápise. */
function assertTruthTraced(before: OkfRecord, after: OkfRecord): void {
  if (before.truth === after.truth) return;
  if (after.timeline.length === before.timeline.length) {
    throw new TimelineIntegrityError(
      `Záznam ${before.id}: zmena sekcie „Truth" musí pridať riadok do „History" v tom istom zápise`,
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
  for (const key of ["title", "summary", "status", "updated"] as const) {
    if (before[key] !== after[key]) lines.push(`~ ${key}: ${before[key]} → ${after[key]}`);
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
