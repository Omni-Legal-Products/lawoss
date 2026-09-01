/**
 * Projekcia pamäte do _STATUS.md.
 *
 * _STATUS.md zostáva ľudským rozhraním spisu — advokát v ňom drží Fázu,
 * Ďalší krok a vlastné poznámky. Stroj prepisuje výhradne obsah medzi
 * markermi. Čo je mimo nich, sa nesmie zmeniť ani o bajt.
 *
 * Markery nesú kanonické názvy, nie jurisdikčné — spis, ktorý zmení
 * jazyk, si tým neroztrhá projekciu.
 */

import type { OkfRecord } from "./record.ts";
import { typeLabel, type Jurisdiction } from "./schema.ts";

export const BLOCKS = ["deadlines", "timeline", "records"] as const;
export type BlockName = (typeof BLOCKS)[number];

const BLOCK_HEADINGS: Record<BlockName, Record<Jurisdiction, string>> = {
  deadlines: { cz: "Lhůty", sk: "Lehoty" },
  timeline: { cz: "Chronologie", sk: "Chronológia" },
  records: { cz: "Záznamy paměti", sk: "Záznamy pamäte" },
};

const EMPTY: Record<Jurisdiction, string> = {
  cz: "_(zatím nic)_",
  sk: "_(zatiaľ nič)_",
};

function startMarker(b: BlockName): string {
  return `<!-- okf:render:${b}:start -->`;
}
function endMarker(b: BlockName): string {
  return `<!-- okf:render:${b}:end -->`;
}

function renderDeadlines(records: readonly OkfRecord[], j: Jurisdiction): string {
  const rows: string[] = [];
  for (const r of records) {
    for (const d of r.deadlines ?? []) rows.push(`| ${d} | ${r.title} | [[${r.id}]] |`);
  }
  if (rows.length === 0) return EMPTY[j];
  rows.sort();
  const head =
    j === "cz" ? "| Datum | Věc | Záznam |" : "| Dátum | Vec | Záznam |";
  return [head, "|---|---|---|", ...rows].join("\n");
}

function renderTimeline(records: readonly OkfRecord[], j: Jurisdiction): string {
  const rows: { date: string; line: string }[] = [];
  for (const r of records) {
    for (const e of r.timeline) {
      rows.push({ date: e.date, line: `| ${e.date} | ${e.text} | [[${r.id}]] |` });
    }
  }
  if (rows.length === 0) return EMPTY[j];
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const head =
    j === "cz" ? "| Datum | Událost | Záznam |" : "| Dátum | Udalosť | Záznam |";
  return [head, "|---|---|---|", ...rows.map((r) => r.line)].join("\n");
}

function renderRecords(records: readonly OkfRecord[], j: Jurisdiction): string {
  if (records.length === 0) return EMPTY[j];
  const head = "| Záznam | Typ | Popis |";
  const rows = [...records]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((r) => `| [[${r.id}]] | ${typeLabel(r.type, j)} | ${r.summary} |`);
  return [head, "|---|---|---|", ...rows].join("\n");
}

const RENDERERS: Record<BlockName, (r: readonly OkfRecord[], j: Jurisdiction) => string> = {
  deadlines: renderDeadlines,
  timeline: renderTimeline,
  records: renderRecords,
};

function replaceBlock(text: string, b: BlockName, body: string): string | undefined {
  const start = text.indexOf(startMarker(b));
  if (start === -1) return undefined;
  const afterStart = start + startMarker(b).length;
  const end = text.indexOf(endMarker(b), afterStart);
  if (end === -1) {
    throw new Error(`Blok ${b} má otvárací marker bez uzatváracieho — súbor sa neprepisuje`);
  }
  return text.slice(0, afterStart) + "\n" + body + "\n" + text.slice(end);
}

function appendBlock(text: string, b: BlockName, body: string, j: Jurisdiction): string {
  const section = [
    "",
    `## ${BLOCK_HEADINGS[b][j]}`,
    startMarker(b),
    body,
    endMarker(b),
    "",
  ].join("\n");
  return text.replace(/\n*$/, "\n") + section;
}

export class RenderConflictError extends Error {}

/**
 * Nadpisy, pod ktorými blok žije v už existujúcich spisoch — vrátane
 * číslovania zo šablóny `mc-novy-spis` (`## 3. Lehoty`).
 */
const BLOCK_HEADING_ALIASES: Record<BlockName, readonly string[]> = {
  deadlines: ["Lhůty", "Lehoty"],
  timeline: ["Chronologie", "Chronológia"],
  records: ["Záznamy paměti", "Záznamy pamäte", "Záznamy"],
};

/**
 * Blok, ktorý sa sám nepridáva — renderuje sa iba tam, kde si ho niekto
 * vyžiadal markerom. Zoznam záznamov patrí do INDEX.md; `_STATUS.md` je
 * rozhranie na vec, nie výpis databázy.
 */
const MARKER_ONLY: readonly BlockName[] = ["records"];

/** Nadpis bloku, ktorý v súbore je, ale markery pod ním nie sú. */
function bareHeading(text: string, b: BlockName): string | undefined {
  for (const alias of BLOCK_HEADING_ALIASES[b]) {
    // Zhoda musí sedieť na celý nadpis — „Lehoty a termíny klienta"
    // je vlastná sekcia advokáta, nie naša projekcia.
    const re = new RegExp(`^##\\s*(?:\\d+\\.\\s*)?${alias}\\s*$`, "mi");
    if (re.test(text)) return alias;
  }
  return undefined;
}

/**
 * Vráti nový obsah _STATUS.md. Ľudské časti prechádzajú nedotknuté,
 * bloky sa prepíšu. Opakované volanie s tou istou pamäťou nič nezmení.
 *
 * Keď sekcia existuje, ale markery v nej nie sú, render **zlyhá**. Ticho
 * pripojiť druhú sekciu na koniec by v spise vyrobilo dve pravdy o lehotách
 * — presne to, čo má projekcia odstrániť.
 */
export function renderStatus(
  existing: string,
  records: readonly OkfRecord[],
  j: Jurisdiction,
): string {
  let out = existing;
  for (const b of BLOCKS) {
    const body = RENDERERS[b](records, j);

    const replaced = replaceBlock(out, b, body);
    if (replaced !== undefined) {
      out = replaced;
      continue;
    }

    const bare = bareHeading(out, b);
    if (bare !== undefined) {
      throw new RenderConflictError(
        `Sekcia „${bare}" v _STATUS.md existuje, ale nemá markery — render by ` +
          `pripojil druhú rovnakú sekciu a v spise by vznikli dve pravdy. ` +
          `Doplň markery cez retrofit a spusti sync znova.`,
      );
    }

    if (MARKER_ONLY.includes(b)) continue;
    out = appendBlock(out, b, body, j);
  }
  return out;
}
