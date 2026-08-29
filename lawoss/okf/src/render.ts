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
import type { Jurisdiction } from "./schema.ts";

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
  const head = j === "cz" ? "| Záznam | Typ | Popis |" : "| Záznam | Typ | Popis |";
  const rows = [...records]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((r) => `| [[${r.id}]] | ${r.type} | ${r.summary} |`);
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

/**
 * Vráti nový obsah _STATUS.md. Ľudské časti prechádzajú nedotknuté,
 * bloky sa prepíšu. Opakované volanie s tou istou pamäťou nič nezmení.
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
    out = replaced ?? appendBlock(out, b, body, j);
  }
  return out;
}
