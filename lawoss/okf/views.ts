/**
 * Prehľad prípadu podľa oblasti a typu práce — čistá funkcia nad tým, čo read-model
 * už načítal (`MatterInput`: karta, záznamy pamäte, `_STATUS.md`, karta klienta,
 * oblasti kancelárie). Nesiaha na disk, nič nedopočítava a nič nezapisuje okrem
 * výslovne volaného `setCardViewTags` (vráti nový text karty, zápis robí volajúci).
 *
 * Stavová lišta (stav, fáza, ďalší krok, najbližší termín) + spoločný základ +
 * kombinovateľné bloky Procesný / Korporátny / IP. Každá položka nesie zdrojový súbor,
 * pole alebo sekciu a deklarovaný čas aktualizácie zo súboru (`updated` záznamu alebo
 * karty, `manual_updated` v `_STATUS.md`), nikdy mtime. Sekcia bez údajov je
 * `not_recorded` („neevidované“), nikdy prázdny zoznam „žiadne“.
 *
 * Záznamy kancelárie (`Office/…`, `_kancelaria/…`) do prehľadu prípadu nepatria: nezapínajú
 * bloky, nie sú stranami, úlohami ani úkonmi a nerobia lehoty prípadu „evidovanými“.
 * Ich lehoty sa ukážu označené ako kancelárske (rovnako ako v Dnes).
 *
 * Stav položky (`ItemState`) opisuje životný cyklus zmeny (agent navrhne, človek schváli,
 * vykoná sa) a odvodí sa len z existujúcich polí:
 *   proposed — `generated` (AI návrh bez ľudského overenia), `instrument_status: draft|negotiated`.
 *   approved — `instrument_status: final`, `fulfillment_status: waived`, ľudské overenie
 *              (`verified` type human k aktuálnej Truth), potvrdená riadená lehota.
 *   executed — riadok `## History` záznamu, ktorý nie je AI návrhom; `procedural_status: taken`,
 *              `instrument_status: signed|effective|registered`, úloha `state: done`,
 *              `fulfillment_status: met` — iba ak história záznamu má zápis z dňa poslednej
 *              zmeny (`updated`) alebo neskôr; inak `unknown` + príznak `unlogged`
 *              (tvrdenie o vykonaní bez zápisu v logu, napr. veta z chatu).
 *   unknown  — lehota zapísaná, ale neoverená.
 * Procesný stav dôkazu (`procedural_status: proposed`) a otvorená požiadavka (`fulfillment_status:
 * open`) nie sú návrhom na schválenie: nesú vlastnú značku („navrhnutý dôkaz“, „otvorená“) bez stavu.
 *
 * Oblasť a typ práce sa odvodia z `matter_kind` (a staršieho onboarding `kind`),
 * `oblast_prava` / `area` (karta aj záznam veci), oblastí kancelárie z `okf.config`
 * a zo súdu / spisovej značky / procesných udalostí v histórii (nie z AI návrhov).
 * Oprava používateľom je existujúce pole karty `tags` s hodnotami `view:procedural|corporate|ip|base`.
 *
 * IP údaje: do rozhodnutia ADR vlastný typ záznamu agenta `ip_right` (L2) v bežnej
 * konvencii `memory/<ID>.md`; polia `right_kind`, `subject_matter`, `owners`,
 * `territories`, `classes`, `application_no`, `application_date`, `registration_no`,
 * `registration_date`, `right_status`, `licences`; obnovy cez existujúce `deadlines`.
 *
 * Strojové hodnoty (role, druhy vzťahov, stavy listín, druhy udalostí…) idú do UI ako
 * značky `tags` (`role:client`, `relation:shareholder`, `instrument:draft`…) a prekladajú
 * sa pri vykreslení; voľný text zo súborov (`label`, `detail`) sa neprekladá.
 */
import type { FmValue, OkfRecord } from "../okf-pamat/src/record.ts";
import { isManagedDeadline, managedDeadlineTrusted } from "./deadline-workflow.ts";
import { provenance } from "./cockpit.ts";
import { deadlineLabel, isOfficeFile, isRetired, recordDeadlines, scopeLevels, taskDue, type MatterInput } from "./read.ts";

export const VIEW_FAMILIES = ["procedural", "corporate", "ip"] as const;
export type ViewFamily = (typeof VIEW_FAMILIES)[number];
export type ItemState = "proposed" | "approved" | "executed" | "unknown";
export type ItemFlag = "conflict" | "unlogged" | "stale" | "overdue" | "invalid";

/** Odkiaľ údaj je: súbor relatívne ku koreňu prehľadu, pole frontmatteru alebo sekcia, deklarovaný čas. */
export type SourceRef = { file: string; field?: string; section?: string; updated?: string };

export type ViewItem = {
  key: string;
  label: string;
  detail?: string;
  /** Strojové značky pre UI (`role:client`, `instrument:draft`, `filing`…) — lokalizujú sa pri vykreslení. */
  tags?: string[];
  date?: string;
  state?: ItemState;
  flags?: ItemFlag[];
  source: SourceRef;
  /** Dokument, na ktorý položka odkazuje (`sources[].resource`), len vnútri priečinka prípadu alebo jeho klienta. */
  document?: string;
};

export const SECTIONS = {
  strip: ["status", "phase", "next_step", "next_date"],
  base: ["client", "parties", "responsible", "dates", "documents", "actions"],
  procedural: ["court", "case_number", "deadlines", "hearings", "filings", "decisions", "evidence", "chronology"],
  corporate: ["entities", "ownership", "change", "corp_decisions", "instruments", "milestones"],
  ip: ["rights", "owners", "territories", "registrations", "renewals", "licences", "disputes"],
} as const;
export type SectionId = (typeof SECTIONS)[keyof typeof SECTIONS][number];

export type ViewSection =
  | { id: SectionId; status: "recorded"; items: ViewItem[] }
  /** `where`: kde by sa údaj evidoval. */
  | { id: SectionId; status: "not_recorded"; where?: SourceRef };

export type ViewBlock = { family: "base" | ViewFamily; sections: ViewSection[] };

export type FamilyReason = {
  family: ViewFamily | "base";
  via: "override" | "work_kind" | "area" | "office_area" | "court" | "case_number" | "history" | "record_type";
  /** Hodnota zo súboru (oblasť, súd, značka) — neprekladá sa. */
  value: string;
  /** Strojová hodnota (`kind:dispute`, `view:ip`, `filing`, `type:ip_right`) — prekladá sa. */
  tag?: string;
  source: SourceRef;
};

export type ViewConflict = { field: "client" | "counterparty" | "court" | "case_number" | "area" | "work_kind"; values: { value: string; tag?: string; source: SourceRef }[] };

export type MatterViews = {
  families: ViewFamily[];
  reasons: FamilyReason[];
  /** Rodiny určil používateľ (`tags: view:*` v karte), nie automatické rozpoznanie. */
  override: boolean;
  /** `dispute|advisory|transaction|other`, ak ho karta alebo starší `kind` nesie. */
  workKind?: string;
  areas: string[];
  /** Krátka stavová lišta nad blokmi: stav, fáza, ďalší krok, najbližší termín. */
  strip: ViewSection[];
  base: ViewBlock;
  blocks: ViewBlock[];
  conflicts: ViewConflict[];
  /** Aspoň jeden živý záznam prípadu (nie kancelárie) nesie pole `deadlines` (aj prázdne). */
  deadlinesRecorded: boolean;
};

// ── pomocné čítanie ───────────────────────────────────────────

const PLACEHOLDER = /^\s*(?:\[?DOPLNI[TŤ]\]?|_\(.*\)_|\{\{.*\}\}|-|—)\s*$/i;
const clean = (value: string | undefined): string | undefined => {
  const v = value?.trim();
  return v && !PLACEHOLDER.test(v) ? v : undefined;
};
/** Porovnanie bez diakritiky, veľkosti písmen a nadbytočných medzier. */
export const fold = (value: string): string => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const same = (a: string, b: string): boolean => fold(a).replace(/[.,]/g, "") === fold(b).replace(/[.,]/g, "");
const unquote = (v: string): string => v.replace(/^(["'])(.*)\1$/s, "$2");

/** `["a", "b"]` / `[a, b]` / `"a"` / `a` z karty (jednoduchý parser kariet necháva zoznam ako text); komentár za `]` sa ignoruje. */
export function cardList(raw: string | undefined): string[] {
  let value = raw?.trim();
  if (!value) return [];
  if (!value.startsWith("[")) { const one = unquote(value.replace(/\s+#.*$/, "").trim()); return clean(one) ? [one] : []; }
  const close = value.indexOf("]");
  if (close >= 0) value = value.slice(0, close + 1);
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter((v) => clean(v) !== undefined);
  } catch { /* bez úvodzoviek: rozdeliť čiarkou */ }
  return value.slice(1, value.endsWith("]") ? -1 : undefined).split(",").map((v) => unquote(v.trim())).filter((v) => clean(v) !== undefined);
}

const extraString = (r: OkfRecord, key: string): string | undefined => {
  const v = r.extra?.[key];
  return typeof v === "string" ? clean(v) : typeof v === "number" ? String(v) : undefined;
};
const extraList = (r: OkfRecord, key: string): string[] => {
  const v: FmValue | undefined = r.extra?.[key];
  if (Array.isArray(v)) return v.flatMap((item) => (typeof item === "string" && clean(item) ? [item.trim()] : []));
  return typeof v === "string" && clean(v) ? [v.trim()] : [];
};

const day = (value: string | undefined): string | undefined => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined);
const joinPath = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);
const within = (dir: string, path: string): boolean => dir === "" || path === dir || path.startsWith(`${dir}/`);

/**
 * `../01_Podklady/x.pdf` voči `memory/` záznamu → cesta v rozsahu prehľadu. Výsledok musí ležať
 * v niektorom z `roots` (priečinok prípadu, jeho klienta); inak nič — dokument iného klienta sa neotvorí.
 */
export function resolveDocument(recordFile: string | undefined, resource: string | undefined, roots: readonly string[]): string | undefined {
  if (!recordFile || !resource || /^[a-z]+:/i.test(resource) || resource.startsWith("/") || resource.includes("\\")) return undefined;
  const parts = recordFile.split("/").slice(0, -1);
  for (const part of resource.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") { if (!parts.length) return undefined; parts.pop(); } else parts.push(part);
  }
  const path = parts.join("/");
  return path && roots.some((root) => root !== "" && within(root, path)) ? path : undefined;
}

type Ctx = {
  input: MatterInput;
  card: Record<string, string>;
  cardFile: string;
  cardUpdated?: string;
  statusFile: string;
  matterRecord?: OkfRecord;
  /** Záznamy prípadu a klienta (bez kancelárie), aj vyradené. */
  own: OkfRecord[];
  /** Živé záznamy prípadu a klienta. */
  live: OkfRecord[];
  /** Živé záznamy kancelárie — len pre lehoty s označením kancelárie. */
  office: OkfRecord[];
  /** Priečinky, do ktorých smie viesť odkaz na dokument (prípad, klient). */
  roots: string[];
  today: string;
  titleOf: (id: string) => string;
};

const fileOf = (ctx: Pick<Ctx, "input">, r: OkfRecord): string => ctx.input.recordFiles?.[r.id] ?? joinPath(ctx.input.path, `memory/${r.id}.md`);
const recordSource = (ctx: Ctx, r: OkfRecord, extra: Omit<SourceRef, "file" | "updated"> = {}): SourceRef => ({ file: fileOf(ctx, r), updated: day(r.updated), ...extra });
const cardSource = (ctx: Ctx, field: string): SourceRef => ({ file: ctx.cardFile, field, ...(ctx.cardUpdated ? { updated: ctx.cardUpdated } : {}) });

/** Záznamy prípadu a klienta, bez kancelárie (súbor v `Office/…` / `_kancelaria/…`). */
export const ownRecords = (input: Pick<MatterInput, "records" | "recordFiles" | "path">): OkfRecord[] =>
  input.records.filter((r) => !isOfficeFile(input.recordFiles?.[r.id]));

/** História má zápis z dňa poslednej zmeny záznamu alebo neskôr — zmena je zaznamenaná v logu. */
const logged = (r: OkfRecord): boolean => {
  const updated = day(r.updated);
  return Boolean(updated && r.timeline.some((e) => (day(e.date) ?? "") >= updated));
};

type StateResult = { state?: ItemState; flags?: ItemFlag[] };

/** Tvrdenie o vykonaní platí, len ak ho log záznamu zachytil. */
function claimed(r: OkfRecord): StateResult {
  return logged(r) ? { state: "executed" } : { state: "unknown", flags: ["unlogged"] };
}

const humanApproved = (r: OkfRecord): boolean => provenance(r) === "overené";
/** AI návrh bez ľudského overenia: jeho tvrdenia ani história nie sú vykonané úkony. */
const aiProposal = (r: OkfRecord): boolean => Boolean(r.extra && "generated" in r.extra) && !humanApproved(r);

/** Stav záznamu v životnom cykle zmeny (pozri hlavičku súboru); bez dôvodu žiadny stav. */
export function recordState(r: OkfRecord): StateResult {
  if (aiProposal(r)) return { state: "proposed" };
  if (r.procedural_status === "taken") return claimed(r);
  if (r.instrument_status) {
    if (["signed", "effective", "registered"].includes(r.instrument_status)) return claimed(r);
    if (r.instrument_status === "final") return { state: "approved" };
    if (["draft", "negotiated"].includes(r.instrument_status)) return { state: "proposed" };
  }
  if (r.fulfillment_status === "met") return claimed(r);
  if (r.fulfillment_status === "waived") return { state: "approved" };
  if (r.type === "task" && r.state === "done") return claimed(r);
  if (humanApproved(r)) return { state: "approved" };
  return {};
}

const withState = (item: Omit<ViewItem, "state" | "flags">, st: StateResult): ViewItem =>
  ({ ...item, ...(st.state ? { state: st.state } : {}), ...(st.flags?.length ? { flags: st.flags } : {}) });

const tagsOf = (...tags: (string | false | undefined)[]): { tags?: string[] } => {
  const list = tags.filter((t): t is string => Boolean(t));
  return list.length ? { tags: list } : {};
};

const section = (id: SectionId, items: ViewItem[], where?: SourceRef): ViewSection =>
  items.length ? { id, status: "recorded", items } : { id, status: "not_recorded", ...(where ? { where } : {}) };

// ── oblasť a typ práce ───────────────────────────────────────

/** Kľúčové slová oblastí (bez diakritiky, začiatok slova), SK aj CS aj EN. Neznáma oblasť → len spoločný základ. */
const AREA_KEYWORDS: Record<ViewFamily, readonly string[]> = {
  ip: ["ochrann", "znamk", "autorsk", "patent", "dizajn", "design", "priemyseln", "prumyslov", "uzitkov", "uzitn", "dusevn", "licenc", "ip", "trademark", "copyright", "intellectual property", "marken", "urheber"],
  corporate: ["obchodne spolocnost", "obchodni spolecnost", "obchodni korporac", "korporat", "corporate", "m&a", "akvizic", "fuzi", "zluceni", "zlucen", "valne zhromazden", "valna hromad", "spolocnik", "spolecnik", "prevod podiel", "prevod podil", "konatel", "jednatel", "obchodny register", "obchodni rejstrik", "gesellschaftsrecht"],
  procedural: ["spor", "sporov", "litig", "sudne konan", "soudni rizeni", "exekuc", "rozhodcov", "rozhodci", "insolvenc", "konkurz"],
};

export function areaFamilies(area: string): ViewFamily[] {
  // Krátke kľúčové slová (≤ 4 znaky: „ip“, „spor“) musia byť celé slovo, dlhšie kmene stačí na začiatku slova.
  const text = ` ${fold(area).replace(/[^\p{L}\p{N}&]+/gu, " ")} `;
  return VIEW_FAMILIES.filter((family) => AREA_KEYWORDS[family].some((kw) => text.includes(kw.length <= 4 ? ` ${kw} ` : ` ${kw}`)));
}

const VIEW_TAG = /^view:(procedural|corporate|ip|base)$/;
const PROCEDURAL_EVENTS = new Set(["filing", "hearing", "decision"]);

function workKindOf(ctx: Ctx): { value?: string; source?: SourceRef; conflict?: ViewConflict } {
  const kind = clean(ctx.card.matter_kind);
  const legacy = clean(ctx.card.kind);
  const legacyMapped = legacy === "contentious" ? "dispute" : legacy === "non_contentious" ? undefined : legacy;
  const conflict: ViewConflict | undefined = kind && legacy && legacyMapped && legacyMapped !== kind
    || kind === "dispute" && legacy === "non_contentious"
    ? { field: "work_kind", values: [{ value: kind ?? "", tag: `kind:${kind ?? ""}`, source: cardSource(ctx, "matter_kind") }, { value: legacy ?? "", tag: `kind:${legacy ?? ""}`, source: cardSource(ctx, "kind") }] }
    : undefined;
  if (kind) return { value: kind, source: cardSource(ctx, "matter_kind"), ...(conflict ? { conflict } : {}) };
  if (legacyMapped) return { value: legacyMapped, source: cardSource(ctx, "kind") };
  const recorded = typeof ctx.matterRecord?.extra?.matter_kind === "string" ? ctx.matterRecord.extra.matter_kind : undefined;
  return recorded && ctx.matterRecord ? { value: recorded, source: recordSource(ctx, ctx.matterRecord, { field: "matter_kind" }) } : {};
}

function detectFamilies(ctx: Ctx, workKind: ReturnType<typeof workKindOf>, areas: { value: string; source: SourceRef }[], caseNumber?: ViewItem, court?: ViewItem): { families: ViewFamily[]; reasons: FamilyReason[]; override: boolean } {
  const tags = cardList(ctx.card.tags).filter((t) => VIEW_TAG.test(t));
  if (tags.length) {
    const reasons: FamilyReason[] = tags.map((t) => ({ family: [...VIEW_FAMILIES, "base" as const].find((f) => t === `view:${f}`) ?? "base", via: "override", value: t, tag: t, source: cardSource(ctx, "tags") }));
    return { families: VIEW_FAMILIES.filter((f) => tags.includes(`view:${f}`)), reasons, override: true };
  }
  const reasons: FamilyReason[] = [];
  if (workKind.value === "dispute" && workKind.source) reasons.push({ family: "procedural", via: "work_kind", value: workKind.value, tag: `kind:${workKind.value}`, source: workKind.source });
  if (court) reasons.push({ family: "procedural", via: "court", value: court.label, source: court.source });
  if (caseNumber) reasons.push({ family: "procedural", via: "case_number", value: caseNumber.label, source: caseNumber.source });
  const office = ctx.input.officeAreas;
  for (const area of areas) {
    for (const family of areaFamilies(area.value)) reasons.push({ family, via: "area", value: area.value, source: area.source });
    // Zhoda s oblasťou kancelárie (`okf.config areas`) je druhý, dohľadateľný dôvod tej istej rodiny.
    const officeLabel = office?.areas.find((label) => same(label, area.value));
    if (officeLabel && office) for (const family of areaFamilies(officeLabel)) reasons.push({ family, via: "office_area", value: officeLabel, source: { file: office.file, field: "areas" } });
  }
  for (const r of ctx.live) {
    if (r.type === "ip_right") reasons.push({ family: "ip", via: "record_type", value: r.type, tag: "type:ip_right", source: recordSource(ctx, r, { field: "type" }) });
    if (r.type === "relation") reasons.push({ family: "corporate", via: "record_type", value: r.type, tag: "type:relation", source: recordSource(ctx, r, { field: "type" }) });
    // Udalosť z AI návrhu nie je vykonaný procesný úkon a blok Konanie nezapína.
    const event = aiProposal(r) ? undefined : r.timeline.find((e) => e.kind && PROCEDURAL_EVENTS.has(e.kind));
    if (event?.kind) reasons.push({ family: "procedural", via: "history", value: event.kind, tag: event.kind, source: recordSource(ctx, r, { section: "History" }) });
  }
  return { families: VIEW_FAMILIES.filter((f) => reasons.some((r) => r.family === f)), reasons, override: false };
}

// ── bloky ────────────────────────────────────────────────────

type DatedEvent = { key: string; date: string; text: string; kind?: string; record: OkfRecord; count: number; proposed: boolean };

/** Udalosti zo `## History` živých záznamov prípadu (log), rovnaké riadky viacerých záznamov raz, najnovšie prvé. */
function historyEvents(ctx: Ctx): DatedEvent[] {
  const byKey = new Map<string, DatedEvent>();
  for (const r of ctx.live) {
    const proposed = aiProposal(r);
    for (const e of r.timeline) {
      const key = `${e.date}\u0000${e.kind ?? ""}\u0000${fold(e.text)}\u0000${proposed ? "p" : ""}`;
      const seen = byKey.get(key);
      if (seen) { seen.count++; continue; }
      byKey.set(key, { key, date: e.date, text: e.text, ...(e.kind ? { kind: e.kind } : {}), record: r, count: 1, proposed });
    }
  }
  return [...byKey.values()].sort((a, b) => b.date.localeCompare(a.date) || a.text.localeCompare(b.text));
}

const eventItem = (ctx: Ctx, e: DatedEvent): ViewItem => ({
  key: `event:${e.key}`, label: e.text, date: day(e.date) ?? e.date, state: e.proposed ? "proposed" : "executed",
  ...tagsOf(e.kind), ...(e.count > 1 ? { detail: `+${e.count - 1}` } : {}),
  source: recordSource(ctx, e.record, { section: "History" }),
});

const RENEWAL = /obnov|renew|verläng|prodlou|predĺž|predlž/i;

function deadlineItems(ctx: Ctx, records: readonly OkfRecord[], officeScope = false): ViewItem[] {
  const out: ViewItem[] = [];
  for (const r of records) {
    const managed = isManagedDeadline(r);
    for (const d of (managed && !managedDeadlineTrusted(r, ctx.input.deadlineWorkflowEvidence) ? [] : recordDeadlines(r))) {
      const prov = provenance(r, ctx.input.deadlineWorkflowEvidence);
      const flags: ItemFlag[] = d.invalid ? ["invalid"] : d.date < ctx.today ? ["overdue"] : [];
      out.push({
        key: `deadline:${fileOf(ctx, r)}:${d.raw}`, label: (d.invalid ? undefined : deadlineLabel(d.raw)) ?? r.title, date: d.date,
        state: prov === "overené" ? "approved" : prov === "AI návrh" ? "proposed" : "unknown",
        ...tagsOf(officeScope && "scope:office"), ...(flags.length ? { flags } : {}), source: recordSource(ctx, r, { field: "deadlines" }),
      });
    }
  }
  return out.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}

/** Lehoty prípadu a klienta + lehoty kancelárie s označením (ako Dnes). */
const allDeadlines = (ctx: Ctx): ViewItem[] =>
  [...deadlineItems(ctx, ctx.live), ...deadlineItems(ctx, ctx.office, true)].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

function taskItems(ctx: Ctx, includeDone: boolean): ViewItem[] {
  return ctx.live.filter((r) => r.type === "task" && (includeDone || r.state !== "done")).map((r) => {
    const st: StateResult = r.state === "done" ? recordState(r) : {};
    const due = taskDue(r.due);
    const dueFlag: ItemFlag[] = r.state === "done" ? [] : due.invalid ? ["invalid"] : due.day && due.day < ctx.today ? ["overdue"] : [];
    const flags: ItemFlag[] = [...(st.flags ?? []), ...dueFlag];
    return { key: `task:${fileOf(ctx, r)}`, label: r.title, ...(r.due ? { date: r.due } : {}), ...(r.assignee ? { detail: r.assignee } : {}), tags: ["task"],
      ...(st.state ? { state: st.state } : {}), ...(flags.length ? { flags } : {}), source: recordSource(ctx, r, { field: r.due ? "due" : "state" }) };
  }).sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
}

/** Text riadku `> **Fáza:** …` z ručnej časti `_STATUS.md`; prázdna šablóna je neevidovaná. */
function manualLine(content: string, labels: readonly string[]): string | undefined {
  for (const line of content.split("\n")) {
    const m = /^\s*>?\s*\*\*([^*:]+):\*\*\s*(.*)$/.exec(line);
    if (m && labels.some((l) => same(l, m[1] ?? ""))) return clean(m[2]);
  }
  return undefined;
}

function manualItem(ctx: Ctx, id: "phase" | "next_step", labels: readonly string[]): ViewItem[] {
  const status = ctx.input.manualStatus;
  const value = status ? manualLine(status.content, labels) : undefined;
  if (!status || !value) return [];
  return [{ key: id, label: value, ...(status.state === "stale" ? { flags: ["stale" as const] } : {}),
    source: { file: ctx.statusFile, section: labels[0], ...(status.updated ? { updated: status.updated } : {}) } }];
}

function cardOrRecord(ctx: Ctx, key: string, cardFields: readonly string[], recordValue: string | undefined, recordField: string, conflictField: ViewConflict["field"], conflicts: ViewConflict[]): ViewItem | undefined {
  const cardField = cardFields.find((f) => clean(ctx.card[f]));
  const cardValue = cardField ? clean(ctx.card[cardField]) : undefined;
  const rec = clean(recordValue);
  const recSource = ctx.matterRecord ? recordSource(ctx, ctx.matterRecord, { field: recordField }) : undefined;
  if (cardValue && rec && recSource && !same(cardValue, rec) && cardField) {
    conflicts.push({ field: conflictField, values: [{ value: cardValue, source: cardSource(ctx, cardField) }, { value: rec, source: recSource }] });
    return { key, label: cardValue, detail: rec, flags: ["conflict"], source: cardSource(ctx, cardField) };
  }
  if (cardValue && cardField) return { key, label: cardValue, source: cardSource(ctx, cardField) };
  if (rec && recSource) return { key, label: rec, source: recSource };
  return undefined;
}

function partyItems(ctx: Ctx, conflicts: ViewConflict[]): ViewItem[] {
  const items: ViewItem[] = [];
  for (const r of ctx.live) {
    if (r.type === "subject") items.push({ key: `party:${fileOf(ctx, r)}`, label: r.title, ...tagsOf(r.role && `role:${r.role}`), source: recordSource(ctx, r, { field: "role" }) });
    (r.participants ?? []).forEach((p, i) => {
      const name = p.name?.trim();
      if (name) items.push({ key: `participant:${fileOf(ctx, r)}:${i}`, label: name, ...(p.role ? { detail: p.role } : {}), source: recordSource(ctx, r, { field: "participants" }) });
    });
  }
  const counterparty = clean(ctx.card.protistrana);
  const opposing = items.filter((i) => i.tags?.includes("role:counterparty"));
  if (counterparty) {
    if (opposing.length && !opposing.some((o) => same(o.label, counterparty))) {
      conflicts.push({ field: "counterparty", values: [{ value: counterparty, source: cardSource(ctx, "protistrana") }, ...opposing.map((o) => ({ value: o.label, source: o.source }))] });
      for (const o of opposing) o.flags = [...(o.flags ?? []), "conflict"];
    }
    if (!opposing.length) items.push({ key: "card:protistrana", label: counterparty, tags: ["role:counterparty"], source: cardSource(ctx, "protistrana") });
  }
  return items;
}

/** Kľúčové dokumenty: prameň a jeho záznam, bez stavu záznamu (dôkaz navrhnutý ≠ dokument je návrh). */
function documentItems(ctx: Ctx): ViewItem[] {
  const out: ViewItem[] = [];
  for (const r of ctx.live) {
    if (r.type === "instrument") continue; // listiny nižšie, so svojím stavom
    (r.sources ?? []).forEach((s, i) => {
      if (!s.resource && !s.title) return;
      const document = resolveDocument(ctx.input.recordFiles?.[r.id], s.resource, ctx.roots);
      out.push({ key: `doc:${fileOf(ctx, r)}:${i}`, label: s.title ?? s.resource ?? r.title, detail: r.title,
        ...(r.origin_date ? { date: r.origin_date } : {}), source: recordSource(ctx, r, { field: "sources" }), ...(document ? { document } : {}) });
    });
  }
  return [...out, ...instrumentItems(ctx)];
}

function instrumentItems(ctx: Ctx): ViewItem[] {
  return ctx.live.filter((r) => r.type === "instrument").map((r) => {
    const document = resolveDocument(ctx.input.recordFiles?.[r.id], r.sources?.[0]?.resource, ctx.roots);
    return withState({ key: `instrument:${fileOf(ctx, r)}`, label: r.title, ...tagsOf(r.instrument_status && `instrument:${r.instrument_status}`, r.form && `form:${r.form}`),
      ...(r.signed_at ? { date: r.signed_at } : {}), source: recordSource(ctx, r, { field: "instrument_status" }), ...(document ? { document } : {}) }, recordState(r));
  });
}

function clientItem(ctx: Ctx, conflicts: ViewConflict[]): ViewItem[] {
  const cardField = clean(ctx.card.klient) ? "klient" : "client";
  const cardClient = clean(ctx.card[cardField]);
  const title = ctx.input.clientTitle;
  // Bez cesty karty klienta je zdrojom priečinok klienta (neotvára sa ako súbor), nikdy prázdna cesta.
  const clientDir = scopeLevels(ctx.input.scopePaths ?? []).find((s) => s.level === "client")?.path;
  const clientSource: SourceRef | undefined = title ? { file: ctx.input.clientCardPath ?? (clientDir !== undefined ? joinPath(clientDir, "") : ctx.cardFile), field: "title" } : undefined;
  if (cardClient && title && clientSource && !same(cardClient, title)) {
    conflicts.push({ field: "client", values: [{ value: title, source: clientSource }, { value: cardClient, source: cardSource(ctx, cardField) }] });
    return [{ key: "client", label: title, detail: cardClient, flags: ["conflict"], source: clientSource }];
  }
  if (title && clientSource) return [{ key: "client", label: title, source: clientSource }];
  return cardClient ? [{ key: "client", label: cardClient, source: cardSource(ctx, cardField) }] : [];
}

/** Stavová lišta: stav (karta), fáza a ďalší krok (`_STATUS.md`), najbližší budúci termín. */
function strip(ctx: Ctx): ViewSection[] {
  const status = clean(ctx.card.status);
  // Termín úlohy smie mať čas („2026-11-20 10:00“); neplatný dátum najbližším termínom nie je.
  const dayOf = (d: ViewItem): string | undefined => d.flags?.includes("invalid") ? undefined : taskDue(d.date).day;
  const next = [...allDeadlines(ctx), ...taskItems(ctx, false)].filter((d) => (dayOf(d) ?? "") >= ctx.today)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))[0];
  return [
    section("status", status ? [{ key: "status", label: status, source: cardSource(ctx, "status") }] : [], { file: ctx.cardFile, field: "status" }),
    section("phase", manualItem(ctx, "phase", ["Fáza", "Fáze", "Phase"]), { file: ctx.statusFile, section: "Fáza" }),
    section("next_step", manualItem(ctx, "next_step", ["Ďalší krok", "Další krok", "Next step", "Nächster Schritt"]), { file: ctx.statusFile, section: "Ďalší krok" }),
    section("next_date", next ? [next] : [], { file: joinPath(ctx.input.path, "memory/"), field: "deadlines" }),
  ];
}

/** Počet posledných úkonov v základe, keď ich celú chronológiu ukazuje blok Konanie. */
const BASE_ACTIONS_WITH_PROCEDURAL = 2;

function baseBlock(ctx: Ctx, conflicts: ViewConflict[], families: readonly ViewFamily[], events: DatedEvent[]): ViewBlock {
  const responsible = clean(ctx.card.advokat) ?? clean(ctx.card.responsible);
  const memory = joinPath(ctx.input.path, "memory/");
  const actions = events.map((e) => eventItem(ctx, e));
  return { family: "base", sections: [
    section("client", clientItem(ctx, conflicts), { file: ctx.cardFile, field: "klient" }),
    section("parties", partyItems(ctx, conflicts), { file: memory, field: "subject" }),
    section("responsible", responsible ? [{ key: "responsible", label: responsible, source: cardSource(ctx, ctx.card.advokat ? "advokat" : "responsible") }] : [], { file: ctx.cardFile, field: "advokat" }),
    // Termíny majú odborné bloky (lehoty, míľniky, obnovy); základ ich ukazuje len bez nich.
    ...(families.length ? [] : [section("dates", [...allDeadlines(ctx), ...taskItems(ctx, false).filter((t) => t.date)].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")), { file: memory, field: "deadlines" })]),
    section("documents", documentItems(ctx), { file: memory, field: "sources" }),
    section("actions", families.includes("procedural") ? actions.slice(0, BASE_ACTIONS_WITH_PROCEDURAL) : actions, { file: memory, section: "History" }),
  ] };
}

function proceduralBlock(ctx: Ctx, events: DatedEvent[], court?: ViewItem, caseNumber?: ViewItem): ViewBlock {
  const memory = joinPath(ctx.input.path, "memory/");
  const ofKind = (kind: string) => events.filter((e) => e.kind === kind).map((e) => eventItem(ctx, e));
  const evidence = ctx.live.filter((r) => r.type === "evidence").map((r) => withState({ key: `evidence:${fileOf(ctx, r)}`, label: r.title,
    ...tagsOf(r.procedural_status && `evidence:${r.procedural_status}`), ...(r.origin_date ? { date: r.origin_date } : {}),
    source: recordSource(ctx, r, { field: "procedural_status" }) }, recordState(r)));
  return { family: "procedural", sections: [
    section("court", court ? [court] : [], { file: ctx.cardFile, field: "sud" }),
    section("case_number", caseNumber ? [caseNumber] : [], { file: ctx.cardFile, field: "spisova_znacka" }),
    section("deadlines", allDeadlines(ctx), { file: memory, field: "deadlines" }),
    section("hearings", ofKind("hearing"), { file: memory, section: "History" }),
    section("filings", ofKind("filing"), { file: memory, section: "History" }),
    section("decisions", ofKind("decision"), { file: memory, section: "History" }),
    section("evidence", evidence, { file: memory, field: "evidence" }),
    section("chronology", events.map((e) => eventItem(ctx, e)), { file: memory, section: "History" }),
  ] };
}

function corporateBlock(ctx: Ctx): ViewBlock {
  const memory = joinPath(ctx.input.path, "memory/");
  const entities: ViewItem[] = ctx.live.filter((r) => r.type === "subject" && (r.person_type === "legal_person" || r.legal_form || r.registered_office)).map((r) => {
    const detail = [r.legal_form, r.registered_office, r.registry_id].filter(Boolean).join(" · ");
    return { key: `entity:${fileOf(ctx, r)}`, label: r.title, ...(detail ? { detail } : {}), ...tagsOf(r.role && `role:${r.role}`), source: recordSource(ctx, r, { field: "legal_form" }) };
  });
  const ownership: ViewItem[] = [
    ...ctx.live.filter((r) => r.type === "relation").map((r) => ({
      key: `relation:${fileOf(ctx, r)}`, label: [r.from_subject, r.to_subject].filter(Boolean).map((id) => ctx.titleOf(id ?? "")).join(" → ") || r.title,
      ...tagsOf(r.relation_kind && `relation:${r.relation_kind}`), ...(r.share ? { detail: r.share } : {}), ...(r.valid_from ? { date: r.valid_from } : {}),
      source: recordSource(ctx, r, { field: "relation_kind" }),
    })),
    ...ctx.live.filter((r) => r.type === "subject").flatMap((r) => [
      ...(r.representatives ?? []).map((p, i) => ({ key: `rep:${fileOf(ctx, r)}:${i}`, label: ctx.titleOf(p), detail: r.title, tags: ["relation:representative"], source: recordSource(ctx, r, { field: "representatives" }) })),
      ...(r.ubo ?? []).map((p, i) => ({ key: `ubo:${fileOf(ctx, r)}:${i}`, label: ctx.titleOf(p), detail: r.title, tags: ["relation:beneficial_owner"], source: recordSource(ctx, r, { field: "ubo" }) })),
    ]),
  ];
  const changeText = clean(ctx.card.subject) ?? clean(ctx.card.description);
  const change: ViewItem[] = changeText ? [{ key: "change", label: changeText, source: cardSource(ctx, clean(ctx.card.subject) ? "subject" : "description") }] : [];
  const decisions = ctx.live.filter((r) => r.type === "decision" || r.type === "requirement").map((r) => withState({
    key: `decision:${fileOf(ctx, r)}`, label: r.title, ...tagsOf(`type:${r.type}`, r.fulfillment_status && `fulfillment:${r.fulfillment_status}`),
    ...(r.demanded_from ? { detail: ctx.titleOf(r.demanded_from) } : {}),
    source: recordSource(ctx, r, { field: r.type === "requirement" ? "fulfillment_status" : "verified" }),
  }, recordState(r)));
  const milestones = [...taskItems(ctx, true), ...allDeadlines(ctx)].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  return { family: "corporate", sections: [
    section("entities", entities, { file: memory, field: "subject" }),
    section("ownership", ownership, { file: memory, field: "relation" }),
    section("change", change, { file: ctx.cardFile, field: "description" }),
    section("corp_decisions", decisions, { file: memory, field: "requirement" }),
    section("instruments", instrumentItems(ctx), { file: memory, field: "instrument" }),
    section("milestones", milestones, { file: memory, field: "due" }),
  ] };
}

const LICENCE = /licen[cs]/i;

const rightItem = (ctx: Ctx) => (r: OkfRecord): ViewItem => {
  const kind = extraString(r, "right_kind");
  const status = extraString(r, "right_status");
  const detail = [extraString(r, "subject_matter"), extraList(r, "classes").length ? extraList(r, "classes").join(", ") : undefined].filter(Boolean).join(" · ");
  return { key: `right:${fileOf(ctx, r)}`, label: r.title, ...tagsOf(kind && `right:${kind}`, status && `right_status:${status}`), ...(detail ? { detail } : {}), source: recordSource(ctx, r, { field: "right_kind" }) };
};

function ipBlock(ctx: Ctx, procedural: boolean, caseNumber?: ViewItem): ViewBlock {
  const rights = ctx.live.filter((r) => r.type === "ip_right");
  const memory = joinPath(ctx.input.path, "memory/");
  const owners: ViewItem[] = [];
  const territories: ViewItem[] = [];
  const registrations: ViewItem[] = [];
  const licenceIds = new Set<string>();
  for (const r of rights) {
    extraList(r, "owners").forEach((o, i) => owners.push({ key: `owner:${fileOf(ctx, r)}:${i}`, label: ctx.titleOf(o), detail: r.title, source: recordSource(ctx, r, { field: "owners" }) }));
    extraList(r, "territories").forEach((t, i) => territories.push({ key: `territory:${fileOf(ctx, r)}:${i}`, label: t, detail: r.title, source: recordSource(ctx, r, { field: "territories" }) }));
    const app = extraString(r, "application_no");
    const reg = extraString(r, "registration_no");
    const appDate = day(extraString(r, "application_date"));
    const regDate = day(extraString(r, "registration_date"));
    if (app) registrations.push({ key: `app:${fileOf(ctx, r)}`, label: app, tags: ["application"], detail: r.title, ...(appDate ? { date: appDate } : {}), source: recordSource(ctx, r, { field: "application_no" }) });
    if (reg) registrations.push({ key: `reg:${fileOf(ctx, r)}`, label: reg, tags: ["registration"], detail: r.title, ...(regDate ? { date: regDate } : {}), source: recordSource(ctx, r, { field: "registration_no" }) });
    for (const id of extraList(r, "licences")) licenceIds.add(id);
  }
  const licences = ctx.live.filter((r) => r.type === "instrument" && (licenceIds.has(r.id) || LICENCE.test(r.title) || LICENCE.test(r.form ?? "") || (r.tags ?? []).some((t) => LICENCE.test(t))))
    .map((r) => withState({ key: `licence:${fileOf(ctx, r)}`, label: r.title, ...tagsOf(r.instrument_status && `instrument:${r.instrument_status}`), ...(r.effective_from ? { date: r.effective_from } : {}), source: recordSource(ctx, r, { field: "instrument_status" }) }, recordState(r)));
  const disputes: ViewItem[] = procedural ? [{ key: "dispute", label: caseNumber?.label ?? clean(ctx.card.title) ?? ctx.input.path, tags: ["procedural_link"], source: caseNumber?.source ?? cardSource(ctx, "matter_kind") }] : [];
  // Termín obnovy je lehota práva s textom o obnove; iná lehota práva ostáva v lehotách prípadu.
  const renewals = deadlineItems(ctx, rights).filter((d) => RENEWAL.test(d.label));
  return { family: "ip", sections: [
    section("rights", rights.map(rightItem(ctx)), { file: memory, field: "ip_right" }),
    section("owners", owners, { file: memory, field: "owners" }),
    section("territories", territories, { file: memory, field: "territories" }),
    section("registrations", registrations, { file: memory, field: "registration_no" }),
    section("renewals", renewals, { file: memory, field: "deadlines" }),
    section("licences", licences, { file: memory, field: "instrument" }),
    section("disputes", disputes, { file: ctx.cardFile, field: "matter_kind" }),
  ] };
}

/** Prehľad jedného prípadu. `today` = RRRR-MM-DD (lehoty po termíne). */
export function buildMatterViews(input: MatterInput, today: string): MatterViews {
  const card = input.cardFrontmatter ?? {};
  const own = ownRecords(input);
  const live = own.filter((r) => !isRetired(r));
  const office = input.records.filter((r) => !isRetired(r) && isOfficeFile(input.recordFiles?.[r.id]));
  const titles = new Map(input.records.map((r) => [r.id, r.title]));
  const matterRecord = own.find((r) => r.type === "matter");
  const roots = [input.path, ...scopeLevels(input.scopePaths ?? []).filter((s) => s.level === "client").map((s) => s.path)].filter((p) => p !== "");
  const ctx: Ctx = {
    input, card, today, own, live, office, roots,
    cardFile: input.cardPath ?? joinPath(input.path, "matter.md"),
    ...(day(card.updated ?? card.timestamp) ? { cardUpdated: day(card.updated ?? card.timestamp) } : {}),
    statusFile: joinPath(input.path, "_STATUS.md"),
    ...(matterRecord ? { matterRecord } : {}),
    titleOf: (id) => titles.get(id) ?? id,
  };
  const conflicts: ViewConflict[] = [];
  const workKind = workKindOf(ctx);
  if (workKind.conflict) conflicts.push(workKind.conflict);
  const caseNumber = cardOrRecord(ctx, "case_number", ["spisova_znacka", "matter_ref"], ctx.matterRecord?.matter_ref, "matter_ref", "case_number", conflicts);
  const court = cardOrRecord(ctx, "court", ["sud", "court"], ctx.matterRecord?.court, "court", "court", conflicts);
  const cardAreas = [...cardList(card.oblast_prava).map((value) => ({ value, source: cardSource(ctx, "oblast_prava") })), ...cardList(card.area).map((value) => ({ value, source: cardSource(ctx, "area") }))];
  const recordAreas = matterRecord ? (matterRecord.area ?? []).filter((a) => clean(a)).map((value) => ({ value, source: recordSource(ctx, matterRecord, { field: "area" }) })) : [];
  if (cardAreas.length && recordAreas.length) {
    const a = new Set(cardAreas.map((x) => fold(x.value)));
    const b = new Set(recordAreas.map((x) => fold(x.value)));
    if (a.size !== b.size || [...a].some((x) => !b.has(x))) conflicts.push({ field: "area", values: [...cardAreas, ...recordAreas] });
  }
  const areas = [...cardAreas, ...recordAreas];
  const detected = detectFamilies(ctx, workKind, areas, caseNumber, court);
  const events = historyEvents(ctx);
  const procedural = detected.families.includes("procedural");
  const blocks = detected.families.map((family) =>
    family === "procedural" ? proceduralBlock(ctx, events, court, caseNumber)
    : family === "corporate" ? corporateBlock(ctx)
    : ipBlock(ctx, procedural, caseNumber));
  const base = baseBlock(ctx, conflicts, detected.families, events);
  return {
    families: detected.families, reasons: detected.reasons, override: detected.override,
    ...(workKind.value ? { workKind: workKind.value } : {}),
    areas: [...new Map(areas.map((a) => [fold(a.value), a.value])).values()],
    strip: strip(ctx), base, blocks, conflicts,
    deadlinesRecorded: recordsDeadlines(input),
  };
}

/** Eviduje prípad (bez záznamov kancelárie) lehoty? Prázdne pole `deadlines: []` je evidencia, chýbajúce pole nie. */
export const recordsDeadlines = (input: Pick<MatterInput, "records" | "recordFiles" | "path">): boolean =>
  ownRecords(input).some((r) => !isRetired(r) && (r.deadlines !== undefined || isManagedDeadline(r)));

/**
 * Koľko prípadov rozsahu lehoty eviduje a koľko nie. „Nič nehorí“ je pravdivé len vtedy,
 * keď ich evidujú všetky (`unrecorded === 0`) a čítanie je úplné.
 */
export function deadlineCoverage(inputs: readonly Pick<MatterInput, "records" | "recordFiles" | "path">[]): { recorded: number; unrecorded: number } {
  const recorded = inputs.filter(recordsDeadlines).length;
  return { recorded, unrecorded: inputs.length - recorded };
}

// ── oprava typu používateľom (pole `tags` karty) ─────────────

/** Riadok `tags:` v karte, ako sa zapíše — rovnaký text ukazuje náhľad pred uložením. */
export function viewTagsLine(content: string, families: readonly ViewFamily[] | null): string {
  return tagsLineFrom(currentTags(content), families);
}

/** To isté nad už načítaným `tags` karty (náhľad v UI pred čítaním súboru). */
export function tagsLineFrom(current: readonly string[], families: readonly ViewFamily[] | null): string {
  const kept = current.filter((t) => !VIEW_TAG.test(t));
  const chosen = families === null ? [] : families.length ? VIEW_FAMILIES.filter((f) => families.includes(f)).map((f) => `view:${f}`) : ["view:base"];
  return `tags: ${JSON.stringify([...kept, ...chosen])}`;
}

function frontmatterLines(content: string): { lines: string[]; end: number; eol: string; bom: string } {
  const bom = content.startsWith("﻿") ? "﻿" : "";
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.slice(bom.length).split(/\r?\n/);
  if (lines[0] !== "---") throw new Error("Karta prípadu nemá frontmatter.");
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new Error("Karta prípadu má neuzavretý frontmatter.");
  return { lines, end, eol, bom };
}

function currentTags(content: string): string[] {
  const { lines, end } = frontmatterLines(content);
  const index = lines.findIndex((l, i) => i > 0 && i < end && /^tags\s*:/.test(l));
  if (index < 0) return [];
  const value = lines[index]!.replace(/^tags\s*:\s*/, "");
  if (!value.trim() && /^\s+-/.test(lines[index + 1] ?? "")) throw new Error("Pole tags je zapísané ako blokový zoznam; upravte ho ručne.");
  return cardList(value);
}

/**
 * Nový text karty s opraveným typom prehľadu. Mení iba riadok `tags:` (ostatné bajty ostávajú);
 * `null` = automatické rozpoznanie (odstráni `view:*`), `[]` = len spoločný základ.
 */
export function setCardViewTags(content: string, families: readonly ViewFamily[] | null): string {
  const { lines, end, eol, bom } = frontmatterLines(content);
  const line = viewTagsLine(content, families);
  const index = lines.findIndex((l, i) => i > 0 && i < end && /^tags\s*:/.test(l));
  // Automatické rozpoznanie bez štítkov view:* nemá čo meniť: karta ostane bajtovo rovnaká.
  if (families === null && !currentTags(content).some((t) => VIEW_TAG.test(t))) return content;
  const next = [...lines];
  if (index >= 0) next[index] = line; else next.splice(end, 0, line);
  return bom + next.join(eol);
}
