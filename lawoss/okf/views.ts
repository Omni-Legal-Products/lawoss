/**
 * Prehľad prípadu podľa oblasti a typu práce — čistá funkcia nad tým, čo read-model
 * už načítal (`MatterInput`: karta, záznamy pamäte, `_STATUS.md`, karta klienta,
 * oblasti kancelárie). Nesiaha na disk, nič nedopočítava a nič nezapisuje okrem
 * výslovne volaného `setCardViewTags` (vráti nový text karty, zápis robí volajúci).
 *
 * Spoločný základ + kombinovateľné bloky Procesný / Korporátny / IP. Každá položka
 * nesie zdrojový súbor, pole alebo sekciu a deklarovaný čas aktualizácie zo súboru
 * (`updated` záznamu alebo karty, `manual_updated` v `_STATUS.md`), nikdy mtime.
 * Sekcia bez údajov je `not_recorded` („neevidované“), nikdy prázdny zoznam „žiadne“.
 *
 * Stav položky (`ItemState`) sa odvodí len z existujúcich polí:
 *   executed — riadok `## History` (log záznamu); `procedural_status: taken`,
 *              `instrument_status: signed|effective|registered`, úloha `state: done`,
 *              `fulfillment_status: met` — iba ak história záznamu má zápis
 *              z dňa poslednej zmeny (`updated`) alebo neskôr; inak `unknown` + príznak
 *              `unlogged` (tvrdenie o vykonaní bez zápisu v logu, napr. veta z chatu).
 *   approved — `instrument_status: final`, `fulfillment_status: waived`, ľudské overenie
 *              (`verified` type human k aktuálnej Truth), potvrdená riadená lehota.
 *   proposed — `generated` (AI návrh), `procedural_status: proposed`,
 *              `instrument_status: draft|negotiated`, `fulfillment_status: open`.
 *   unknown  — ostatné (zapísané, ale neoverené).
 *
 * Oblasť a typ práce sa odvodia z `matter_kind` (a staršieho onboarding `kind`),
 * `oblast_prava` / `area` (karta aj záznam veci), oblastí kancelárie z `okf.config`
 * a zo súdu / spisovej značky / procesných udalostí v histórii. Oprava používateľom
 * je existujúce pole karty `tags` s hodnotami `view:procedural|corporate|ip|base`.
 *
 * IP údaje: do rozhodnutia ADR vlastný typ záznamu agenta `ip_right` (L2) v bežnej
 * konvencii `memory/<ID>.md`; polia `right_kind`, `subject_matter`, `owners`,
 * `territories`, `classes`, `application_no`, `application_date`, `registration_no`,
 * `registration_date`, `right_status`, `licences`; obnovy cez existujúce `deadlines`.
 */
import type { FmValue, OkfRecord } from "../okf-pamat/src/record.ts";
import { isManagedDeadline, managedDeadlineTrusted } from "./deadline-workflow.ts";
import { provenance } from "./cockpit.ts";
import { deadlineLabel, isRetired, recordDeadlines, type MatterInput } from "./read.ts";

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
  /** Strojová značka pre UI (rola, druh registrácie, druh udalosti) — lokalizuje sa pri vykreslení. */
  tag?: string;
  date?: string;
  state?: ItemState;
  flags?: ItemFlag[];
  source: SourceRef;
  /** Dokument, na ktorý položka odkazuje (`sources[].resource`), ak sa dá dohľadať v rozsahu prípadu. */
  document?: string;
};

export const SECTIONS = {
  base: ["client", "parties", "responsible", "status", "phase", "next_step", "dates", "documents", "actions"],
  procedural: ["court", "case_number", "deadlines", "hearings", "filings", "decisions", "evidence", "chronology"],
  corporate: ["entities", "ownership", "change", "corp_decisions", "instruments", "milestones"],
  ip: ["rights", "owners", "territories", "registrations", "renewals", "licences", "disputes"],
} as const;
export type SectionId = (typeof SECTIONS)[keyof typeof SECTIONS][number];

export type ViewSection =
  | { id: SectionId; status: "recorded"; items: ViewItem[] }
  /** `where`: kde by sa údaj evidoval — UI povie „neevidované“ a odkáže sem. */
  | { id: SectionId; status: "not_recorded"; where?: SourceRef };

export type ViewBlock = { family: "base" | ViewFamily; sections: ViewSection[] };

export type FamilyReason = {
  family: ViewFamily | "base";
  via: "override" | "work_kind" | "area" | "office_area" | "court" | "case_number" | "history" | "record_type";
  value: string;
  source: SourceRef;
};

export type ViewConflict = { field: "client" | "counterparty" | "court" | "case_number" | "area" | "work_kind"; values: { value: string; source: SourceRef }[] };

export type MatterViews = {
  families: ViewFamily[];
  reasons: FamilyReason[];
  /** Rodiny určil používateľ (`tags: view:*` v karte), nie automatické rozpoznanie. */
  override: boolean;
  /** `dispute|advisory|transaction|other`, ak ho karta alebo starší `kind` nesie. */
  workKind?: string;
  areas: string[];
  base: ViewBlock;
  blocks: ViewBlock[];
  conflicts: ViewConflict[];
  /** Aspoň jeden živý záznam nesie pole `deadlines` (aj prázdne) — inak lehoty nie sú evidované. */
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

/** `["a", "b"]` / `[a, b]` / `a` z karty (jednoduchý parser kariet necháva zoznam ako text). */
export function cardList(raw: string | undefined): string[] {
  const value = raw?.trim();
  if (!value) return [];
  if (!value.startsWith("[")) return clean(value) ? [value] : [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter((v) => clean(v) !== undefined);
  } catch { /* bez úvodzoviek: rozdeliť čiarkou */ }
  return value.slice(1, value.endsWith("]") ? -1 : undefined).split(",").map((v) => v.trim().replace(/^["']|["']$/g, "")).filter((v) => clean(v) !== undefined);
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

/** `../01_Podklady/x.pdf` voči `memory/` záznamu → cesta v rozsahu prehľadu; mimo rozsahu nič. */
function resolveDocument(recordFile: string | undefined, resource: string | undefined): string | undefined {
  if (!recordFile || !resource || /^[a-z]+:/i.test(resource) || resource.startsWith("/") || resource.includes("\\")) return undefined;
  const parts = recordFile.split("/").slice(0, -1);
  for (const part of resource.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") { if (!parts.length) return undefined; parts.pop(); } else parts.push(part);
  }
  return parts.join("/") || undefined;
}

type Ctx = {
  input: MatterInput;
  card: Record<string, string>;
  cardFile: string;
  cardUpdated?: string;
  statusFile: string;
  matterRecord?: OkfRecord;
  live: OkfRecord[];
  today: string;
  titleOf: (id: string) => string;
};

const fileOf = (ctx: Ctx, r: OkfRecord): string => ctx.input.recordFiles?.[r.id] ?? joinPath(ctx.input.path, `memory/${r.id}.md`);
const recordSource = (ctx: Ctx, r: OkfRecord, extra: Omit<SourceRef, "file" | "updated"> = {}): SourceRef => ({ file: fileOf(ctx, r), updated: day(r.updated), ...extra });
const cardSource = (ctx: Ctx, field: string): SourceRef => ({ file: ctx.cardFile, field, ...(ctx.cardUpdated ? { updated: ctx.cardUpdated } : {}) });

/** História má zápis z dňa poslednej zmeny záznamu alebo neskôr — zmena je zaznamenaná v logu. */
const logged = (r: OkfRecord): boolean => {
  const updated = day(r.updated);
  return Boolean(updated && r.timeline.some((e) => (day(e.date) ?? "") >= updated));
};

/** Tvrdenie o vykonaní platí, len ak ho log záznamu zachytil. */
function claimed(r: OkfRecord): { state: ItemState; flags?: ItemFlag[] } {
  return logged(r) ? { state: "executed" } : { state: "unknown", flags: ["unlogged"] };
}

function humanApproved(r: OkfRecord): boolean {
  return provenance(r) === "overené";
}

/** Stav záznamu podľa jeho vlastných polí (pozri hlavičku súboru). */
export function recordState(r: OkfRecord): { state: ItemState; flags?: ItemFlag[] } {
  if (r.extra && "generated" in r.extra && !humanApproved(r)) return { state: "proposed" };
  if (r.procedural_status === "taken") return claimed(r);
  if (r.procedural_status === "proposed") return { state: "proposed" };
  if (r.instrument_status) {
    if (["signed", "effective", "registered"].includes(r.instrument_status)) return claimed(r);
    if (r.instrument_status === "final") return { state: "approved" };
    if (["draft", "negotiated"].includes(r.instrument_status)) return { state: "proposed" };
  }
  if (r.fulfillment_status) {
    if (r.fulfillment_status === "met") return claimed(r);
    if (r.fulfillment_status === "waived") return { state: "approved" };
    if (r.fulfillment_status === "open") return { state: "proposed" };
  }
  if (r.type === "task" && r.state === "done") return claimed(r);
  if (humanApproved(r)) return { state: "approved" };
  return { state: "unknown" };
}

const withState = (item: Omit<ViewItem, "state" | "flags">, st: { state: ItemState; flags?: ItemFlag[] }): ViewItem =>
  ({ ...item, state: st.state, ...(st.flags?.length ? { flags: st.flags } : {}) });

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
    ? { field: "work_kind", values: [{ value: kind ?? "", source: cardSource(ctx, "matter_kind") }, { value: legacy ?? "", source: cardSource(ctx, "kind") }] }
    : undefined;
  if (kind) return { value: kind, source: cardSource(ctx, "matter_kind"), ...(conflict ? { conflict } : {}) };
  if (legacyMapped) return { value: legacyMapped, source: cardSource(ctx, "kind") };
  const recorded = typeof ctx.matterRecord?.extra?.matter_kind === "string" ? ctx.matterRecord.extra.matter_kind : undefined;
  return recorded && ctx.matterRecord ? { value: recorded, source: recordSource(ctx, ctx.matterRecord, { field: "matter_kind" }) } : {};
}

function detectFamilies(ctx: Ctx, workKind: ReturnType<typeof workKindOf>, areas: { value: string; source: SourceRef }[], caseNumber?: ViewItem, court?: ViewItem): { families: ViewFamily[]; reasons: FamilyReason[]; override: boolean } {
  const tags = cardList(ctx.card.tags).filter((t) => VIEW_TAG.test(t));
  if (tags.length) {
    const reasons: FamilyReason[] = tags.map((t) => ({ family: [...VIEW_FAMILIES, "base" as const].find((f) => t === `view:${f}`) ?? "base", via: "override", value: t, source: cardSource(ctx, "tags") }));
    return { families: VIEW_FAMILIES.filter((f) => tags.includes(`view:${f}`)), reasons, override: true };
  }
  const reasons: FamilyReason[] = [];
  if (workKind.value === "dispute" && workKind.source) reasons.push({ family: "procedural", via: "work_kind", value: workKind.value, source: workKind.source });
  if (court) reasons.push({ family: "procedural", via: "court", value: court.label, source: court.source });
  if (caseNumber) reasons.push({ family: "procedural", via: "case_number", value: caseNumber.label, source: caseNumber.source });
  const office = ctx.input.officeAreas;
  for (const area of areas) {
    for (const family of areaFamilies(area.value)) reasons.push({ family, via: "area", value: area.value, source: area.source });
    const officeLabel = office?.areas.find((label) => same(label, area.value));
    if (officeLabel && office) for (const family of areaFamilies(officeLabel)) reasons.push({ family, via: "office_area", value: officeLabel, source: { file: office.file, field: "areas" } });
  }
  for (const r of ctx.live) {
    if (r.type === "ip_right") reasons.push({ family: "ip", via: "record_type", value: r.type, source: recordSource(ctx, r, { field: "type" }) });
    if (r.type === "relation") reasons.push({ family: "corporate", via: "record_type", value: r.type, source: recordSource(ctx, r, { field: "type" }) });
    const event = r.timeline.find((e) => e.kind && PROCEDURAL_EVENTS.has(e.kind));
    if (event?.kind) reasons.push({ family: "procedural", via: "history", value: event.kind, source: recordSource(ctx, r, { section: "History" }) });
  }
  return { families: VIEW_FAMILIES.filter((f) => reasons.some((r) => r.family === f)), reasons, override: false };
}

// ── bloky ────────────────────────────────────────────────────

type DatedEvent = { key: string; date: string; text: string; kind?: string; record: OkfRecord; count: number };

/** Udalosti zo `## History` (log záznamov), rovnaké riadky viacerých záznamov raz, najnovšie prvé. */
function historyEvents(ctx: Ctx): DatedEvent[] {
  const byKey = new Map<string, DatedEvent>();
  for (const r of ctx.input.records) {
    for (const e of r.timeline) {
      const key = `${e.date}\u0000${e.kind ?? ""}\u0000${fold(e.text)}`;
      const seen = byKey.get(key);
      if (seen) { seen.count++; continue; }
      byKey.set(key, { key, date: e.date, text: e.text, ...(e.kind ? { kind: e.kind } : {}), record: r, count: 1 });
    }
  }
  return [...byKey.values()].sort((a, b) => b.date.localeCompare(a.date) || a.text.localeCompare(b.text));
}

const eventItem = (ctx: Ctx, e: DatedEvent): ViewItem => ({
  key: `event:${e.key}`, label: e.text, date: day(e.date) ?? e.date, state: "executed",
  ...(e.kind ? { tag: e.kind } : {}), ...(e.count > 1 ? { detail: `+${e.count - 1}` } : {}),
  source: recordSource(ctx, e.record, { section: "History" }),
});

function deadlineItems(ctx: Ctx, records: readonly OkfRecord[]): ViewItem[] {
  const out: ViewItem[] = [];
  for (const r of records) {
    const managed = isManagedDeadline(r);
    for (const d of (managed && !managedDeadlineTrusted(r, ctx.input.deadlineWorkflowEvidence) ? [] : recordDeadlines(r))) {
      const prov = provenance(r, ctx.input.deadlineWorkflowEvidence);
      const flags: ItemFlag[] = d.invalid ? ["invalid"] : d.date < ctx.today ? ["overdue"] : [];
      out.push({
        key: `deadline:${fileOf(ctx, r)}:${d.raw}`, label: (d.invalid ? undefined : deadlineLabel(d.raw)) ?? r.title, date: d.date,
        state: prov === "overené" ? "approved" : prov === "AI návrh" ? "proposed" : "unknown",
        ...(flags.length ? { flags } : {}), source: recordSource(ctx, r, { field: "deadlines" }),
      });
    }
  }
  return out.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}

function taskItems(ctx: Ctx, includeDone: boolean): ViewItem[] {
  return ctx.live.filter((r) => r.type === "task" && (includeDone || r.state !== "done")).map((r) => {
    const st = r.state === "done" ? recordState(r) : { state: "unknown" as const };
    const flags: ItemFlag[] = [...(st.flags ?? []), ...(r.due && r.state !== "done" && r.due < ctx.today ? ["overdue" as const] : [])];
    return { key: `task:${fileOf(ctx, r)}`, label: r.title, ...(r.due ? { date: r.due } : {}), ...(r.assignee ? { detail: r.assignee } : {}), tag: "task",
      ...(r.state === "done" ? { state: st.state } : {}), ...(flags.length ? { flags } : {}), source: recordSource(ctx, r, { field: r.due ? "due" : "state" }) };
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
    if (r.type === "subject") items.push({ key: `party:${fileOf(ctx, r)}`, label: r.title, ...(r.role ? { tag: `role:${r.role}` } : {}), source: recordSource(ctx, r, { field: "role" }) });
    (r.participants ?? []).forEach((p, i) => {
      const name = p.name?.trim();
      if (name) items.push({ key: `participant:${fileOf(ctx, r)}:${i}`, label: name, ...(p.role ? { detail: p.role } : {}), source: recordSource(ctx, r, { field: "participants" }) });
    });
  }
  const counterparty = clean(ctx.card.protistrana);
  const opposing = items.filter((i) => i.tag === "role:counterparty");
  if (counterparty) {
    if (opposing.length && !opposing.some((o) => same(o.label, counterparty))) {
      conflicts.push({ field: "counterparty", values: [{ value: counterparty, source: cardSource(ctx, "protistrana") }, ...opposing.map((o) => ({ value: o.label, source: o.source }))] });
      for (const o of opposing) o.flags = [...(o.flags ?? []), "conflict"];
    }
    if (!opposing.length) items.push({ key: "card:protistrana", label: counterparty, tag: "role:counterparty", source: cardSource(ctx, "protistrana") });
  }
  return items;
}

function documentItems(ctx: Ctx): ViewItem[] {
  const out: ViewItem[] = [];
  for (const r of ctx.live) {
    if (r.type === "instrument") continue; // listiny sú vo vlastnej sekcii korporátneho bloku a v základe nižšie
    (r.sources ?? []).forEach((s, i) => {
      if (!s.resource && !s.title) return;
      const document = resolveDocument(ctx.input.recordFiles?.[r.id], s.resource);
      out.push(withState({ key: `doc:${fileOf(ctx, r)}:${i}`, label: s.title ?? s.resource ?? r.title, detail: r.title,
        ...(r.origin_date ? { date: r.origin_date } : {}), source: recordSource(ctx, r, { field: "sources" }), ...(document ? { document } : {}) }, recordState(r)));
    });
  }
  return [...out, ...instrumentItems(ctx)];
}

function instrumentItems(ctx: Ctx): ViewItem[] {
  return ctx.live.filter((r) => r.type === "instrument").map((r) => {
    const document = resolveDocument(ctx.input.recordFiles?.[r.id], r.sources?.[0]?.resource);
    return withState({ key: `instrument:${fileOf(ctx, r)}`, label: r.title, ...(r.instrument_status ? { tag: r.instrument_status } : {}),
      ...(r.form ? { detail: r.form } : {}), ...(r.signed_at ? { date: r.signed_at } : {}), source: recordSource(ctx, r, { field: "instrument_status" }), ...(document ? { document } : {}) }, recordState(r));
  });
}

function baseBlock(ctx: Ctx, conflicts: ViewConflict[], procedural: boolean, events: DatedEvent[]): ViewBlock {
  const client: ViewItem[] = [];
  const cardClient = clean(ctx.card.klient) ?? clean(ctx.card.client);
  const title = ctx.input.clientTitle;
  const clientSource: SourceRef | undefined = title ? { file: ctx.input.clientCardPath ?? ctx.input.scopePaths?.[1] ?? "", field: "title" } : undefined;
  if (cardClient && title && clientSource && !same(cardClient, title)) {
    conflicts.push({ field: "client", values: [{ value: title, source: clientSource }, { value: cardClient, source: cardSource(ctx, ctx.card.klient ? "klient" : "client") }] });
    client.push({ key: "client", label: title, detail: cardClient, flags: ["conflict"], source: clientSource });
  } else if (title && clientSource) client.push({ key: "client", label: title, source: clientSource });
  else if (cardClient) client.push({ key: "client", label: cardClient, source: cardSource(ctx, ctx.card.klient ? "klient" : "client") });

  const responsible = clean(ctx.card.advokat) ?? clean(ctx.card.responsible);
  const status = clean(ctx.card.status);
  const dates = [...(procedural ? [] : deadlineItems(ctx, ctx.input.records)), ...taskItems(ctx, false).filter((t) => t.date)];
  return { family: "base", sections: [
    section("client", client, { file: ctx.cardFile, field: "klient" }),
    section("parties", partyItems(ctx, conflicts), { file: joinPath(ctx.input.path, "memory/"), field: "subject" }),
    section("responsible", responsible ? [{ key: "responsible", label: responsible, source: cardSource(ctx, ctx.card.advokat ? "advokat" : "responsible") }] : [], { file: ctx.cardFile, field: "advokat" }),
    section("status", status ? [{ key: "status", label: status, source: cardSource(ctx, "status") }] : [], { file: ctx.cardFile, field: "status" }),
    section("phase", manualItem(ctx, "phase", ["Fáza", "Fáze", "Phase"]), { file: ctx.statusFile, section: "Fáza" }),
    section("next_step", manualItem(ctx, "next_step", ["Ďalší krok", "Další krok", "Next step", "Nächster Schritt"]), { file: ctx.statusFile, section: "Ďalší krok" }),
    section("dates", dates.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")), { file: joinPath(ctx.input.path, "memory/"), field: "deadlines" }),
    section("documents", documentItems(ctx), { file: joinPath(ctx.input.path, "memory/"), field: "sources" }),
    section("actions", events.map((e) => eventItem(ctx, e)), { file: joinPath(ctx.input.path, "memory/"), section: "History" }),
  ] };
}

function proceduralBlock(ctx: Ctx, events: DatedEvent[], court?: ViewItem, caseNumber?: ViewItem): ViewBlock {
  const ofKind = (kind: string) => events.filter((e) => e.kind === kind).map((e) => eventItem(ctx, e));
  const evidence = ctx.live.filter((r) => r.type === "evidence").map((r) => withState({ key: `evidence:${fileOf(ctx, r)}`, label: r.title,
    ...(r.origin_date ? { date: r.origin_date } : {}), source: recordSource(ctx, r, { field: "procedural_status" }) }, recordState(r)));
  return { family: "procedural", sections: [
    section("court", court ? [court] : [], { file: ctx.cardFile, field: "sud" }),
    section("case_number", caseNumber ? [caseNumber] : [], { file: ctx.cardFile, field: "spisova_znacka" }),
    section("deadlines", deadlineItems(ctx, ctx.input.records), { file: joinPath(ctx.input.path, "memory/"), field: "deadlines" }),
    section("hearings", ofKind("hearing"), { file: joinPath(ctx.input.path, "memory/"), section: "History" }),
    section("filings", ofKind("filing"), { file: joinPath(ctx.input.path, "memory/"), section: "History" }),
    section("decisions", ofKind("decision"), { file: joinPath(ctx.input.path, "memory/"), section: "History" }),
    section("evidence", evidence, { file: joinPath(ctx.input.path, "memory/"), field: "evidence" }),
    section("chronology", events.map((e) => eventItem(ctx, e)), { file: joinPath(ctx.input.path, "memory/"), section: "History" }),
  ] };
}

function corporateBlock(ctx: Ctx): ViewBlock {
  const entities = ctx.live.filter((r) => r.type === "subject" && (r.person_type === "legal_person" || r.legal_form || r.registered_office)).map((r) => ({
    key: `entity:${fileOf(ctx, r)}`, label: r.title, detail: [r.legal_form, r.registered_office, r.registry_id].filter(Boolean).join(" · ") || undefined,
    ...(r.role ? { tag: `role:${r.role}` } : {}), source: recordSource(ctx, r, { field: "legal_form" }),
  })).map(({ detail, ...rest }) => (detail ? { ...rest, detail } : rest));
  const ownership: ViewItem[] = [
    ...ctx.live.filter((r) => r.type === "relation").map((r) => ({
      key: `relation:${fileOf(ctx, r)}`, label: [r.from_subject, r.to_subject].filter(Boolean).map((id) => ctx.titleOf(id ?? "")).join(" → ") || r.title,
      ...(r.relation_kind ? { tag: `relation:${r.relation_kind}` } : {}), ...(r.share ? { detail: r.share } : {}), ...(r.valid_from ? { date: r.valid_from } : {}),
      source: recordSource(ctx, r, { field: "relation_kind" }),
    })),
    ...ctx.live.filter((r) => r.type === "subject").flatMap((r) => [
      ...(r.representatives ?? []).map((p, i) => ({ key: `rep:${fileOf(ctx, r)}:${i}`, label: ctx.titleOf(p), detail: r.title, tag: "relation:representative", source: recordSource(ctx, r, { field: "representatives" }) })),
      ...(r.ubo ?? []).map((p, i) => ({ key: `ubo:${fileOf(ctx, r)}:${i}`, label: ctx.titleOf(p), detail: r.title, tag: "relation:beneficial_owner", source: recordSource(ctx, r, { field: "ubo" }) })),
    ]),
  ];
  const changeText = clean(ctx.card.subject) ?? clean(ctx.card.description);
  const change: ViewItem[] = changeText ? [{ key: "change", label: changeText, source: cardSource(ctx, ctx.card.subject && clean(ctx.card.subject) ? "subject" : "description") }] : [];
  const decisions = ctx.live.filter((r) => r.type === "decision" || r.type === "requirement").map((r) => withState({
    key: `decision:${fileOf(ctx, r)}`, label: r.title, tag: r.type, ...(r.demanded_from ? { detail: ctx.titleOf(r.demanded_from) } : {}),
    source: recordSource(ctx, r, { field: r.type === "requirement" ? "fulfillment_status" : "verified" }),
  }, recordState(r)));
  const milestones = [...taskItems(ctx, true), ...deadlineItems(ctx, ctx.input.records)].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  return { family: "corporate", sections: [
    section("entities", entities, { file: joinPath(ctx.input.path, "memory/"), field: "subject" }),
    section("ownership", ownership, { file: joinPath(ctx.input.path, "memory/"), field: "relation" }),
    section("change", change, { file: ctx.cardFile, field: "description" }),
    section("corp_decisions", decisions, { file: joinPath(ctx.input.path, "memory/"), field: "requirement" }),
    section("instruments", instrumentItems(ctx), { file: joinPath(ctx.input.path, "memory/"), field: "instrument" }),
    section("milestones", milestones, { file: joinPath(ctx.input.path, "memory/"), field: "due" }),
  ] };
}

const LICENCE = /licen[cs]/i;

const rightItem = (ctx: Ctx) => (r: OkfRecord): ViewItem => {
  const kind = extraString(r, "right_kind");
  const detail = [extraString(r, "subject_matter"), extraList(r, "classes").length ? extraList(r, "classes").join(", ") : undefined, extraString(r, "right_status")].filter(Boolean).join(" · ");
  return { key: `right:${fileOf(ctx, r)}`, label: r.title, ...(kind ? { tag: `right:${kind}` } : {}), ...(detail ? { detail } : {}), source: recordSource(ctx, r, { field: "right_kind" }) };
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
    if (app) registrations.push({ key: `app:${fileOf(ctx, r)}`, label: app, tag: "application", detail: r.title, ...(day(extraString(r, "application_date")) ? { date: day(extraString(r, "application_date")) } : {}), source: recordSource(ctx, r, { field: "application_no" }) });
    if (reg) registrations.push({ key: `reg:${fileOf(ctx, r)}`, label: reg, tag: "registration", detail: r.title, ...(day(extraString(r, "registration_date")) ? { date: day(extraString(r, "registration_date")) } : {}), source: recordSource(ctx, r, { field: "registration_no" }) });
    for (const id of extraList(r, "licences")) licenceIds.add(id);
  }
  const licences = ctx.live.filter((r) => r.type === "instrument" && (licenceIds.has(r.id) || LICENCE.test(r.title) || LICENCE.test(r.form ?? "") || (r.tags ?? []).some((t) => LICENCE.test(t))))
    .map((r) => withState({ key: `licence:${fileOf(ctx, r)}`, label: r.title, ...(r.instrument_status ? { tag: r.instrument_status } : {}), ...(r.effective_from ? { date: r.effective_from } : {}), source: recordSource(ctx, r, { field: "instrument_status" }) }, recordState(r)));
  const disputes: ViewItem[] = procedural ? [{ key: "dispute", label: caseNumber?.label ?? clean(ctx.card.title) ?? ctx.input.path, tag: "procedural_link", source: caseNumber?.source ?? cardSource(ctx, "matter_kind") }] : [];
  return { family: "ip", sections: [
    section("rights", rights.map(rightItem(ctx)), { file: memory, field: "ip_right" }),
    section("owners", owners, { file: memory, field: "owners" }),
    section("territories", territories, { file: memory, field: "territories" }),
    section("registrations", registrations, { file: memory, field: "registration_no" }),
    section("renewals", deadlineItems(ctx, rights), { file: memory, field: "deadlines" }),
    section("licences", licences, { file: memory, field: "instrument" }),
    section("disputes", disputes, { file: ctx.cardFile, field: "matter_kind" }),
  ] };
}

/** Prehľad jedného prípadu. `today` = RRRR-MM-DD (lehoty po termíne). */
export function buildMatterViews(input: MatterInput, today: string): MatterViews {
  const card = input.cardFrontmatter ?? {};
  const live = input.records.filter((r) => !isRetired(r));
  const titles = new Map(input.records.map((r) => [r.id, r.title]));
  const matterRecord = input.records.find((r) => r.type === "matter");
  const ctx: Ctx = {
    input, card, today, live,
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
  const base = baseBlock(ctx, conflicts, procedural, events);
  return {
    families: detected.families, reasons: detected.reasons, override: detected.override,
    ...(workKind.value ? { workKind: workKind.value } : {}),
    areas: [...new Map(areas.map((a) => [fold(a.value), a.value])).values()],
    base, blocks, conflicts,
    deadlinesRecorded: input.records.some((r) => !isRetired(r) && (r.deadlines !== undefined || isManagedDeadline(r))),
  };
}

/** Evidujú niektoré prípady rozsahu lehoty? Bez toho „žiadne lehoty“ nie je pravdivé tvrdenie. */
export const deadlinesRecorded = (inputs: readonly Pick<MatterInput, "records">[]): boolean =>
  inputs.some((i) => i.records.some((r) => !isRetired(r) && (r.deadlines !== undefined || isManagedDeadline(r))));

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
  const next = [...lines];
  if (index >= 0) next[index] = line; else next.splice(end, 0, line);
  return bom + next.join(eol);
}
