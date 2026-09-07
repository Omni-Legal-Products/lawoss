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
import { typeLabel, valueLabel, type Jurisdiction } from "./schema.ts";

/**
 * Preloží identifikátor záznamu na cestu k jeho súboru, relatívne k súboru,
 * do ktorého sa odkaz píše. Vracia `undefined`, keď súbor nepoznáme.
 */
export type LinkResolver = (id: string) => string | undefined;

/**
 * Odkaz na záznam. **Markdown, nie `[[…]]`.**
 *
 * Wiki-odkaz `[[S-001]]` sa v Obsidiane hľadá podľa názvu súboru, ale súbor
 * sa volá `S-001-eva-novakova.md` — odkaz teda nikdy nesadol a v grafe visel
 * ako osirelý. Relatívny markdown odkaz mieri na skutočný súbor, funguje
 * v Obsidiane aj mimo neho a je to tvar, ktorý žiada Open Knowledge Format.
 *
 * Keď cestu nepoznáme, vypíše sa holý identifikátor. Žiadny odkaz je lepší
 * než odkaz, ktorý nikam nevedie.
 */
function odkaz(id: string, href?: LinkResolver): string {
  const cesta = href?.(id);
  return cesta ? `[${id}](${cesta})` : id;
}

export const BLOCKS = ["deadlines", "timeline", "records", "evidence_matrix", "tasks"] as const;
export type BlockName = (typeof BLOCKS)[number];

const BLOCK_HEADINGS: Record<BlockName, Record<Jurisdiction, string>> = {
  deadlines: { cz: "Lhůty", sk: "Lehoty" },
  timeline: { cz: "Chronologie", sk: "Chronológia" },
  records: { cz: "Záznamy paměti", sk: "Záznamy pamäte" },
  evidence_matrix: { cz: "Dokazování", sk: "Dokazovanie" },
  tasks: { cz: "Otevřené úkoly", sk: "Otvorené úlohy" },
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

function renderDeadlines(records: readonly OkfRecord[], j: Jurisdiction, href?: LinkResolver): string {
  const rows: string[] = [];
  for (const r of records) {
    for (const d of r.deadlines ?? []) rows.push(`| ${d} | ${r.title} | ${odkaz(r.id, href)} |`);
  }
  if (rows.length === 0) return EMPTY[j];
  rows.sort();
  const head =
    j === "cz" ? "| Datum | Věc | Záznam |" : "| Dátum | Vec | Záznam |";
  return [head, "|---|---|---|", ...rows].join("\n");
}

function renderTimeline(records: readonly OkfRecord[], j: Jurisdiction, href?: LinkResolver): string {
  const rows: { date: string; line: string }[] = [];
  for (const r of records) {
    for (const e of r.timeline) {
      rows.push({
        date: e.date,
        line: `| ${e.date} | ${e.kind ? valueLabel("event_kind", e.kind, j) : ""} | ${e.text} | ${odkaz(r.id, href)} |`,
      });
    }
  }
  if (rows.length === 0) return EMPTY[j];
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const head =
    j === "cz" ? "| Datum | Druh | Událost | Záznam |" : "| Dátum | Druh | Udalosť | Záznam |";
  return [head, "|---|---|---|---|", ...rows.map((r) => r.line)].join("\n");
}

function renderRecords(records: readonly OkfRecord[], j: Jurisdiction, href?: LinkResolver): string {
  if (records.length === 0) return EMPTY[j];
  const head = "| Záznam | Typ | Popis |";
  const rows = [...records]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((r) => `| ${odkaz(r.id, href)} | ${typeLabel(r.type, j)} | ${r.description} |`);
  return [head, "|---|---|---|", ...rows].join("\n");
}

/**
 * Sila väzby medzi tvrdením a dôkazom. Nie je to právny záver — je to
 * zobrazenie dvoch hodnôt, ktoré advokát zapísal (`evidence_strength`
 * a `reliability`). Stav preukázania sa z nej **neodvodzuje**.
 */
function cellMark(claim: OkfRecord, e: OkfRecord): string {
  if ((claim.contradicting_evidence ?? []).includes(e.id)) return "✗";
  if (!(claim.supporting_evidence ?? []).includes(e.id)) return "–";
  if (e.evidence_strength === "indirect") return "~";
  if (e.evidence_strength === "direct" && e.reliability === "high") return "✓✓";
  return "✓";
}

const MATRIX_LABELS: Record<Jurisdiction, Record<string, string>> = {
  cz: {
    claim: "Tvrzení", state: "Stav", burden: "Břemeno nese", credibility: "Věrohodnost",
    legend: "✓✓ přímý a spolehlivý · ✓ podpůrný · ~ nepřímý · ✗ vyvrací · – nesouvisí",
    burdenHead: "Důkazní břemeno",
  },
  sk: {
    claim: "Tvrdenie", state: "Stav", burden: "Bremeno nesie", credibility: "Vierohodnosť",
    legend: "✓✓ priamy a spoľahlivý · ✓ podporný · ~ nepriamy · ✗ vyvracia · – nesúvisí",
    burdenHead: "Dôkazné bremeno",
  },
};

function renderEvidenceMatrix(records: readonly OkfRecord[], j: Jurisdiction, _href?: LinkResolver): string {
  const claims = records.filter((r) => r.type === "claim").sort((a, b) => (a.id < b.id ? -1 : 1));
  if (claims.length === 0) return EMPTY[j];
  const evidence = records.filter((r) => r.type === "evidence").sort((a, b) => (a.id < b.id ? -1 : 1));
  const L = MATRIX_LABELS[j];

  const head = [L.claim, ...evidence.map((e) => e.id), L.state];
  const rows = claims.map((c) => [
    c.id,
    ...evidence.map((e) => cellMark(c, e)),
    valueLabel("proof_status", c.proof_status ?? "—", j),
  ]);

  const bremeno = [
    `| ${L.claim} | ${L.burden} | ${L.state} | ${L.credibility} |`,
    "|---|---|---|---|",
    ...claims.map(
      (c) =>
        `| ${c.id} | ${c.burden_of_proof ?? "—"} | ` +
        `${valueLabel("proof_status", c.proof_status ?? "—", j)} | ` +
        `${valueLabel("credibility", c.credibility ?? "—", j)} |`,
    ),
  ];

  return [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
    "",
    `_${L.legend}_`,
    "",
    `**${L.burdenHead}**`,
    "",
    ...bremeno,
  ].join("\n");
}

/**
 * Prehľad otvorených úloh. `due` je interný záväzok — do tabuľky lehôt
 * nepatrí. Zmeškaný interný termín sa dá dohnať, zmeškaná procesná lehota nie.
 */
function renderTasks(records: readonly OkfRecord[], j: Jurisdiction, href?: LinkResolver): string {
  const open = records
    .filter((r) => r.type === "task" && r.state !== "done")
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (open.length === 0) return EMPTY[j];
  const head =
    j === "cz" ? "| Úkol | Věc | Řeší | Stav | Termín |" : "| Úloha | Vec | Rieši | Stav | Termín |";
  const rows = open.map(
    (t) =>
      `| ${odkaz(t.id, href)} | ${t.title} | ${t.assignee ?? "—"} | ` +
      `${valueLabel("state", t.state ?? "—", j)} | ${t.due ?? "—"} |`,
  );
  return [head, "|---|---|---|---|---|", ...rows].join("\n");
}

const RENDERERS: Record<BlockName, (r: readonly OkfRecord[], j: Jurisdiction, href?: LinkResolver) => string> = {
  deadlines: renderDeadlines,
  timeline: renderTimeline,
  records: renderRecords,
  evidence_matrix: renderEvidenceMatrix,
  tasks: renderTasks,
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
 * Kostra `_STATUS.md` pre novú vec — všetkých päť blokov s markermi.
 *
 * Bloky `records`, `evidence_matrix` a `tasks` sa do existujúceho súboru
 * nikdy nepridávajú samy (MARKER_ONLY): advokátovu šablónu nerozširujeme.
 * Dôsledok bol, že na čerstvo založenej veci sa matica dôkazov ani úlohy
 * neukázali nikdy — desať vecí z ISIR malo tvrdenia, dôkazy aj úlohy, a
 * `_STATUS.md` ukazoval len lehoty a chronológiu. Kostru vlastní `init`.
 */
export function statusSkeleton(j: Jurisdiction): string {
  const head =
    j === "cz"
      ? "# Status věci\n\n> **Fáze:** \n> **Další krok:** \n"
      : "# Status veci\n\n> **Fáza:** \n> **Ďalší krok:** \n";
  return BLOCKS.reduce((t, b) => appendBlock(t, b, EMPTY[j], j), head);
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
  evidence_matrix: ["Dokazování", "Dokazovanie"],
  tasks: ["Otevřené úkoly", "Otvorené úlohy", "Úkoly", "Úlohy"],
};

/**
 * Blok, ktorý sa sám nepridáva — renderuje sa iba tam, kde si ho niekto
 * vyžiadal markerom. Zoznam záznamov patrí do INDEX.md; `_STATUS.md` je
 * rozhranie na vec, nie výpis databázy.
 */
export const MARKER_ONLY: readonly BlockName[] = ["records", "evidence_matrix", "tasks"];

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
  href?: LinkResolver,
): string {
  let out = existing;
  for (const b of BLOCKS) {
    const body = RENDERERS[b](records, j, href);

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
