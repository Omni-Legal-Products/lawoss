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
import { documentTypeLabel as typeLabel, documentValueLabel as valueLabel, renderLanguage, type DocumentLanguage, type RenderLanguage } from "./document-language.ts";
import { maskValue } from "./mask.ts";

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

/**
 * Poradie je poradím v kostre nového `_STATUS.md`: strany a fakty hore, lehoty
 * a chronológia, úlohy, dokumenty; záznamy a dokazovanie sú marker-only.
 * Strany, fakty a dokumenty pribudli 11. 9. 2026: šablóna Fázy A ich má ako
 * sekcie 1, 2 a 6 a bez projekcie ostávali prázdne, hoci pamäť dáta mala.
 */
export const BLOCKS = ["parties", "facts", "deadlines", "timeline", "tasks", "documents", "records", "evidence_matrix"] as const;
export type BlockName = (typeof BLOCKS)[number];

const BLOCK_HEADINGS: Record<BlockName, Record<RenderLanguage, string>> = {
  deadlines: { cz: "Lhůty", sk: "Lehoty", en: "Deadlines" },
  timeline: { cz: "Chronologie", sk: "Chronológia", en: "Timeline" },
  records: { cz: "Záznamy paměti", sk: "Záznamy pamäte", en: "Memory records" },
  evidence_matrix: { cz: "Dokazování", sk: "Dokazovanie", en: "Evidence assessment" },
  tasks: { cz: "Otevřené úkoly", sk: "Otvorené úlohy", en: "Open tasks" },
  parties: { cz: "Strany", sk: "Strany", en: "Parties" },
  facts: { cz: "Fakta věci", sk: "Fakty veci", en: "Matter facts" },
  documents: { cz: "Klíčové dokumenty", sk: "Kľúčové dokumenty", en: "Key documents" },
};

const EMPTY: Record<RenderLanguage, string> = {
  cz: "_(zatím nic)_",
  sk: "_(zatiaľ nič)_",
  en: "_(nothing yet)_",
};

function startMarker(b: BlockName): string {
  return `<!-- okf:render:${b}:start -->`;
}
function endMarker(b: BlockName): string {
  return `<!-- okf:render:${b}:end -->`;
}

function renderDeadlines(records: readonly OkfRecord[], j: RenderLanguage, href?: LinkResolver): string {
  const rows: string[] = [];
  for (const r of records) {
    for (const d of r.deadlines ?? []) rows.push(`| ${d} | ${r.title} | ${odkaz(r.id, href)} |`);
  }
  if (rows.length === 0) return EMPTY[j];
  rows.sort();
  const head =
    j === "en" ? "| Date | Matter | Record |" : j === "cz" ? "| Datum | Věc | Záznam |" : "| Dátum | Vec | Záznam |";
  return [head, "|---|---|---|", ...rows].join("\n");
}

function renderTimeline(records: readonly OkfRecord[], j: RenderLanguage, href?: LinkResolver): string {
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
    j === "en" ? "| Date | Kind | Event | Record |" : j === "cz" ? "| Datum | Druh | Událost | Záznam |" : "| Dátum | Druh | Udalosť | Záznam |";
  return [head, "|---|---|---|---|", ...rows.map((r) => r.line)].join("\n");
}

function renderRecords(records: readonly OkfRecord[], j: RenderLanguage, href?: LinkResolver): string {
  if (records.length === 0) return EMPTY[j];
  const head = j === "en" ? "| Record | Type | Description |" : "| Záznam | Typ | Popis |";
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

const MATRIX_LABELS: Record<RenderLanguage, Record<string, string>> = {
  en: { claim: "Claim", state: "State", burden: "Burden rests on", credibility: "Credibility",
    legend: "✓✓ direct and reliable · ✓ supporting · ~ indirect · ✗ contradicts · – unrelated", burdenHead: "Burden of proof" },
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

function renderEvidenceMatrix(records: readonly OkfRecord[], j: RenderLanguage, _href?: LinkResolver): string {
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
function renderTasks(records: readonly OkfRecord[], j: RenderLanguage, href?: LinkResolver): string {
  const open = records
    .filter((r) => r.type === "task" && r.state !== "done")
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (open.length === 0) return EMPTY[j];
  const head =
    j === "en" ? "| Task | Matter | Assignee | State | Due date |" : j === "cz" ? "| Úkol | Věc | Řeší | Stav | Termín |" : "| Úloha | Vec | Rieši | Stav | Termín |";
  const rows = open.map(
    (t) =>
      `| ${odkaz(t.id, href)} | ${t.title} | ${t.assignee ?? "—"} | ` +
      `${valueLabel("state", t.state ?? "—", j)} | ${t.due ?? "—"} |`,
  );
  return [head, "|---|---|---|---|---|", ...rows].join("\n");
}

/** Bunka tabuľky: zvislá čiara a nový riadok by rozbili markdown. */
function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

/** Odkaz na prameň záznamu: URL alebo cesta relatívna k priečinku veci. */
function sourceLink(s: { id?: string; title?: string; resource?: string }): string {
  const label = s.title ?? s.id ?? s.resource ?? "?";
  if (!s.resource) return cell(label);
  const name = /^https?:\/\//.test(s.resource) ? label : (s.resource.split("/").pop() ?? label);
  return `[${cell(name)}](${s.resource})`;
}

const ROLE_ORDER = ["client", "counterparty", "representative", "ubo"];

/** Strany zo subjektov. Rodné číslo maskované — status číta aj ten, kto AML evidenciu vidieť nemá. */
function renderParties(records: readonly OkfRecord[], j: RenderLanguage, href?: LinkResolver): string {
  const subjects = records
    .filter((r) => r.type === "subject")
    .sort((a, b) => ROLE_ORDER.indexOf(a.role ?? "") - ROLE_ORDER.indexOf(b.role ?? "") || (a.id < b.id ? -1 : 1));
  if (subjects.length === 0) return EMPTY[j];
  const head = j === "en" ? "| Role | Subject | Registry / personal ID | Record |" : j === "cz" ? "| Role | Subjekt | IČO / RČ | Záznam |" : "| Rola | Subjekt | IČO / RČ | Záznam |";
  const rows = subjects.map((s) => {
    const ident = s.registry_id ?? (s.birth_number ? maskValue("birth_number", s.birth_number) : "—");
    return `| ${valueLabel("role", s.role ?? "—", j)} | ${cell(s.title)} | ${ident} | ${odkaz(s.id, href)} |`;
  });
  return [head, "|---|---|---|---|", ...rows].join("\n");
}

/**
 * Fakty veci: každý riadok pravdy záznamu veci je jeden fakt, poznámka pod
 * čiarou `[^id]` sa premení na odkaz na prameň. Tvrdenia strán (claim) idú
 * za nimi so svojím pôvodcom — sú to tvrdenia, nie zistenia.
 */
function renderFacts(records: readonly OkfRecord[], j: RenderLanguage, href?: LinkResolver): string {
  const rows: string[] = [];
  let n = 0;
  const byId = (a: OkfRecord, b: OkfRecord) => (a.id < b.id ? -1 : 1);
  for (const r of records.filter((x) => x.type === "matter").sort(byId)) {
    const src = new Map((r.sources ?? []).map((s) => [s.id ?? "", s]));
    for (const raw of r.truth.split("\n")) {
      const line = raw.replace(/^[-*]\s+/, "").trim();
      if (!line) continue;
      const refs = [...line.matchAll(/\[\^([^\]]+)\]/g)].map((m) => m[1] ?? "");
      const text = line.replace(/\[\^[^\]]+\]/g, "").replace(/\*\*/g, "").trim();
      const zdroj = refs.map((id) => { const s = src.get(id); return s ? sourceLink(s) : `[^${id}]`; }).join(", ") || "—";
      const kedy = refs.map((id) => src.get(id)?.last_modified).find(Boolean) ?? r.updated;
      rows.push(`| ${++n} | ${cell(text)} | ${zdroj} | ${kedy} | ${odkaz(r.id, href)} |`);
    }
  }
  for (const c of records.filter((x) => x.type === "claim").sort(byId)) {
    const kto = c.claimed_by ? (j === "en" ? `claimed by ${c.claimed_by}` : `tvrdí ${c.claimed_by}`) : "—";
    rows.push(`| ${++n} | ${cell(c.title)} | ${cell(kto)} | ${c.claimed_at ?? c.updated} | ${odkaz(c.id, href)} |`);
  }
  if (rows.length === 0) return EMPTY[j];
  const head = j === "en" ? "| # | Fact | Source | Recorded | Record |" : j === "cz" ? "| # | Fakt | Zdroj | Zjištěno | Záznam |" : "| # | Fakt | Zdroj | Zistené | Záznam |";
  return [head, "|---|---|---|---|---|", ...rows].join("\n");
}

/** Kľúčové dokumenty z dôkazov: kde listina leží — URL registra alebo súbor vo veci. */
function renderDocuments(records: readonly OkfRecord[], j: RenderLanguage, href?: LinkResolver): string {
  const docs = records.filter((r) => r.type === "evidence").sort((a, b) => (a.id < b.id ? -1 : 1));
  if (docs.length === 0) return EMPTY[j];
  const head = j === "en" ? "| Document | Kind | Date | Location | Record |" : j === "cz" ? "| Dokument | Druh | Datum | Umístění | Záznam |" : "| Dokument | Druh | Dátum | Umiestnenie | Záznam |";
  const rows = docs.map((e) => {
    const kde = (e.sources ?? []).filter((s) => s.resource).map(sourceLink).join(", ") || "—";
    return `| ${cell(e.title)} | ${valueLabel("evidence_kind", e.evidence_kind ?? "—", j)} | ${e.origin_date ?? "—"} | ${kde} | ${odkaz(e.id, href)} |`;
  });
  return [head, "|---|---|---|---|---|", ...rows].join("\n");
}

const RENDERERS: Record<BlockName, (r: readonly OkfRecord[], j: RenderLanguage, href?: LinkResolver) => string> = {
  parties: renderParties,
  facts: renderFacts,
  documents: renderDocuments,
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

function appendBlock(text: string, b: BlockName, body: string, j: RenderLanguage): string {
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
export function statusSkeleton(j: Jurisdiction, language?: DocumentLanguage): string {
  const locale = renderLanguage(language, j);
  const head =
    locale === "en" ? "# Matter status\n\n> **Phase:**\n> **Next step:**\n" : locale === "cz"
      ? "# Status věci\n\n> **Fáze:**\n> **Další krok:**\n"
      : "# Status veci\n\n> **Fáza:**\n> **Ďalší krok:**\n";
  return BLOCKS.reduce((t, b) => appendBlock(t, b, EMPTY[locale], locale), `---\ntype: status\nmanual_updated: ""\n---\n\n${head}`);
}

export class RenderConflictError extends Error {}

/**
 * Nadpisy, pod ktorými blok žije v už existujúcich spisoch — vrátane
 * číslovania zo šablóny `mc-novy-spis` (`## 3. Lehoty`).
 */
const BLOCK_HEADING_ALIASES: Record<BlockName, readonly string[]> = {
  deadlines: ["Deadlines", "Lhůty", "Lehoty"],
  timeline: ["Timeline", "Chronologie", "Chronológia"],
  records: ["Memory records", "Záznamy paměti", "Záznamy pamäte", "Záznamy"],
  evidence_matrix: ["Evidence assessment", "Dokazování", "Dokazovanie"],
  tasks: ["Open tasks", "Otevřené úkoly", "Otvorené úlohy", "Úkoly", "Úlohy"],
  // Sekcie 1, 2 a 6 šablóny Fázy A.
  parties: ["Parties", "Strany", "Strany věci", "Strany veci", "Účastníci", "Účastníci řízení"],
  facts: ["Matter facts", "Fakta věci", "Fakty veci", "Fakta", "Fakty", "Skutkový stav"],
  documents: ["Key documents", "Klíčové dokumenty", "Kľúčové dokumenty", "Dokumenty", "Listiny"],
};

/**
 * Blok, ktorý sa sám nepridáva — renderuje sa iba tam, kde si ho niekto
 * vyžiadal markerom. Zoznam záznamov patrí do INDEX.md; `_STATUS.md` je
 * rozhranie na vec, nie výpis databázy.
 */
/**
 * Marker-only bloky sa do cudzieho súboru samy nepridávajú (podmienka MČ k O1:
 * markery do existujúcich sekcií, nie rast súboru). Kostra novej veci ich má,
 * do existujúceho statusu ich doplní `retrofit`.
 */
export const MARKER_ONLY: readonly BlockName[] = ["records", "evidence_matrix", "tasks", "parties", "facts", "documents"];

/**
 * „Strany", „Fakty" a „Dokumenty" sú bežné nadpisy, ktoré si advokát píše
 * sám. Keby ich holá sekcia blokovala sync ako pri lehotách, po tejto verzii
 * by sa zastavil každý existujúci status. Preto: holý nadpis = sekcia
 * advokáta, blok sa nepridá a nič sa nehlási; markery doplní iba výslovný
 * `retrofit`.
 */
export const SOFT_HEADING: readonly BlockName[] = ["parties", "facts", "documents"];

/** Nadpis bloku, ktorý v súbore je, ale markery pod ním nie sú. */
function bareHeading(text: string, b: BlockName): string | undefined {
  return findBareHeading(text, b)?.alias;
}

/** Kde presne nadpis bez markerov leží — pre retrofit. */
function findBareHeading(text: string, b: BlockName): { alias: string; end: number } | undefined {
  for (const alias of BLOCK_HEADING_ALIASES[b]) {
    // Zhoda musí sedieť na celý nadpis — „Lehoty a termíny klienta"
    // je vlastná sekcia advokáta, nie naša projekcia.
    const re = new RegExp(`^##\\s*(?:\\d+\\.\\s*)?${alias}\\s*$`, "mi");
    const m = re.exec(text);
    // `\s*$` s príznakom m zhltne aj koniec riadka — koniec nadpisu je bez neho.
    if (m) return { alias, end: m.index + m[0].trimEnd().length };
  }
  return undefined;
}

/**
 * Retrofit: do sekcií, ktoré v `_STATUS.md` už sú, ale nemajú markery, vloží
 * markery **hneď pod nadpis**. Čo advokát v sekcii mal, ostáva pod nimi —
 * nič sa nemaže, nič sa nepripája na koniec súboru. Druhé spustenie nenájde
 * nič holé a nezmení nič (idempotentné). Spis založený cez `/novy-spis` má
 * šablónu s `## 3. Lehoty` bez markerov a `sync` naň končí konfliktom —
 * presne pre tento prípad.
 */
export function retrofitStatus(
  existing: string,
  records: readonly OkfRecord[],
  j: Jurisdiction,
  href?: LinkResolver,
  language?: DocumentLanguage,
): { text: string; inserted: BlockName[] } {
  const locale = renderLanguage(language, j);
  let out = existing;
  const inserted: BlockName[] = [];
  for (const b of BLOCKS) {
    if (out.includes(startMarker(b))) continue;
    const hit = findBareHeading(out, b);
    if (!hit) continue;
    const body = RENDERERS[b](records, locale, href);
    out = out.slice(0, hit.end) + `\n${startMarker(b)}\n${body}\n${endMarker(b)}\n` + out.slice(hit.end);
    inserted.push(b);
  }
  return { text: out, inserted };
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
  language?: DocumentLanguage,
): string {
  const locale = renderLanguage(language, j);
  let out = existing;
  for (const b of BLOCKS) {
    const body = RENDERERS[b](records, locale, href);

    const replaced = replaceBlock(out, b, body);
    if (replaced !== undefined) {
      out = replaced;
      continue;
    }

    const bare = bareHeading(out, b);
    if (bare !== undefined && SOFT_HEADING.includes(b)) continue;
    if (bare !== undefined) {
      throw new RenderConflictError(
        `Sekcia „${bare}" v _STATUS.md existuje, ale nemá markery — render by ` +
          `pripojil druhú rovnakú sekciu a v spise by vznikli dve pravdy. ` +
          `Doplň markery cez retrofit a spusti sync znova.`,
      );
    }

    if (MARKER_ONLY.includes(b)) continue;
    out = appendBlock(out, b, body, locale);
  }
  return out;
}

/** Všetko mimo projekcií ostáva v kontexte vrátane vlastných poznámok.
 * Odstránenie odvodených nadpisov udrží read stabilné pri prvom syncu. */
export function manualStatusContent(text: string): string {
  let out = text;
  for (const block of BLOCKS) {
    const start = startMarker(block);
    const end = endMarker(block);
    if (!out.includes(start) && !out.includes(end)) continue;
    const first = out.indexOf(start);
    const last = out.indexOf(end);
    if (first < 0 || last < first || out.indexOf(start, first + start.length) >= 0 || out.indexOf(end, last + end.length) >= 0) {
      throw new RenderConflictError(`Neúplné alebo duplicitné markery ${block} v _STATUS.md; otvor celý súbor.`);
    }
    let prefix = out.slice(0, first);
    for (const heading of BLOCK_HEADING_ALIASES[block]) {
      prefix = prefix.replace(new RegExp(`(?:^|\\n)##[ \t]*(?:\\d+\\.[ \t]*)?${heading}[ \t]*\\r?\\n[ \t]*$`, "i"), "\n");
    }
    out = prefix + out.slice(last + end.length);
  }
  // Sync smie zmeniť oddeľovacie prázdne riadky, nie ručný obsah.
  return out.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
