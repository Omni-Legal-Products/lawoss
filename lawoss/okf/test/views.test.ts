/**
 * Prehľady podľa oblasti a typu práce (alfa2 C2). Vstupy sú syntetické a tvarom kopírujú dátovú
 * sadu `02_OKF_kancelaria` (M001 procesný, M003/M012 korporátny, M006 IP, M066 IP + spor). Ak je
 * pieskovisko na disku, posledný blok testov beží aj nad jeho dočasnou kópiou (nikdy nad originálom).
 * Syntetický právny obsah nie je overené právne poradenstvo.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { parseRecord } from "../../okf-pamat/src/record.ts";
import { readManualStatus } from "../../okf-pamat/src/manual-status.ts";
import { parseFrontmatter } from "../src/core.ts";
import type { MatterInput } from "../read.ts";
import { areaFamilies, buildMatterViews, cardList, deadlineCoverage, recordState, recordsDeadlines, resolveDocument, setCardViewTags, viewTagsLine, type MatterViews, type SectionId, type ViewBlock } from "../views.ts";

const TODAY = "2026-10-23";

type Rec = { id: string; type: string; title: string; fields?: Record<string, string>; history?: string[]; updated?: string };
function record({ id, type, title, fields = {}, history = ["2026-09-01 [request] - Vytvorenie syntetického záznamu."], updated = "2026-10-17" }: Rec) {
  const fm = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
  return parseRecord(`---\nokf: 0.2\nid: "${id}"\ntype: "${type}"\ntitle: "${title}"\ndescription: "Syntetický záznam."\nlayer: "L2"\njurisdiction: "sk"\nstatus: "active"\ncreated: "2026-09-01"\nupdated: "${updated}"\n${fm}\n---\n\n## Truth\n\nSyntetický obsah.\n\n## History\n\n${history.map((h) => `- ${h}`).join("\n")}\n`);
}

function matter(path: string, card: Record<string, string>, records: Rec[], extra: Partial<MatterInput> = {}): MatterInput {
  const parsed = records.map(record);
  return {
    path, cardPath: `${path}/matter.md`, cardFrontmatter: { title: "Syntetický prípad", updated: "2026-10-17", ...card },
    records: parsed, recordFiles: Object.fromEntries(parsed.map((r) => [r.id, `${path}/memory/${r.id}.md`])),
    scopePaths: [path, "Klienti/C001"], clientTitle: "SYN Tatran Automatika, s. r. o.", clientCardPath: "Klienti/C001/client.md", ...extra,
  };
}

const sectionOf = (block: ViewBlock | undefined, id: SectionId) => block?.sections.find((s) => s.id === id);
const items = (block: ViewBlock | undefined, id: SectionId) => { const s = sectionOf(block, id); return s?.status === "recorded" ? s.items : []; };
const block = (v: MatterViews, family: ViewBlock["family"]) => (family === "base" ? v.base : v.blocks.find((b) => b.family === family));

const PARTIES: Rec[] = [
  { id: "M-S1", type: "subject", title: "SYN Tatran Automatika, s. r. o.", fields: { role: '"client"', person_type: '"legal_person"', legal_form: '"s. r. o."', registered_office: '"SYN Bratislava"' } },
  { id: "M-S2", type: "subject", title: "SYN Partner 001, s. r. o.", fields: { role: '"counterparty"', person_type: '"legal_person"' } },
];
const M001_CARD = { klient: "SYN Tatran Automatika, s. r. o.", protistrana: "SYN Partner 001, s. r. o.", oblast_prava: '["obchodné záväzky"]', spisova_znacka: "SYN-M001/2026", sud: "SYN testový súd", matter_kind: "dispute", status: "aktívny", advokat: "SYN Advokát 01", tags: "[]" };
const M001_RECORDS: Rec[] = [
  { id: "M-MAT", type: "matter", title: "Úhrada dodávok", fields: { area: '["obchodné záväzky"]', matter_ref: '"SYN-M001/2026"', court: '"SYN testový súd"' } },
  ...PARTIES,
  { id: "M-E1", type: "evidence", title: "Podklad k tvrdeniu 1", fields: { evidence_kind: '"document"', procedural_status: '"proposed"', origin_date: '"2025-02-03"', "sources:\n  - id": '"SRC1"\n    title: "01-zmluva.docx"\n    resource: "../01_Podklady/IN-001/01-zmluva.docx"' } },
  { id: "M-T1", type: "task", title: "Vyžiadať chýbajúcu prílohu", fields: { assignee: '"SYN Advokát 01"', state: '"pending"', due: '"2026-10-20"' } },
];

describe("odvodenie oblasti a typu práce", () => {
  test("kľúčové slová oblasti SK/CS bez diakritiky", () => {
    expect(areaFamilies("ochranné známky")).toEqual(["ip"]);
    expect(areaFamilies("autorské právo")).toEqual(["ip"]);
    expect(areaFamilies("obchodné spoločnosti")).toEqual(["corporate"]);
    expect(areaFamilies("korporátne poradenstvo")).toEqual(["corporate"]);
    expect(areaFamilies("Obchodní korporace")).toEqual(["corporate"]);
    expect(areaFamilies("obchodné záväzky")).toEqual([]);
    expect(areaFamilies("IP")).toEqual(["ip"]);
    // Krátke slová len celé: „spor“, „IP“ áno; „sporiteľne“, „IPO“ nie.
    expect(areaFamilies("sporiteľne a úvery")).toEqual([]);
    expect(areaFamilies("IPO poradenstvo")).toEqual([]);
    expect(areaFamilies("obchodný spor")).toEqual(["procedural"]);
    expect(areaFamilies("sporové konanie")).toEqual(["procedural"]);
    expect(areaFamilies("rozpory v účtovníctve")).toEqual([]);
  });

  test("množné „spory“, anglické „disputes“ a trestné veci sú procesné; podiel na nehnuteľnosti nie je korporátny (#223)", () => {
    for (const area of ["Spory", "Súdne spory", "Soudní spory", "Disputes", "dispute resolution", "trestné veci", "Trestní právo"]) {
      expect(areaFamilies(area)).toEqual(["procedural"]);
    }
    expect(areaFamilies("převod podílu na nemovitosti")).toEqual([]);
    expect(areaFamilies("prevod podielu na pozemku")).toEqual([]);
    for (const area of ["prevod obchodného podielu", "převod obchodního podílu", "obchodní podíl", "obchodný podiel"]) {
      expect(areaFamilies(area)).toEqual(["corporate"]);
    }
  });

  test("zoznam z karty v tvare JSON aj bez úvodzoviek; šablóna je neevidovaná", () => {
    expect(cardList('["obchodné záväzky", "iné"]')).toEqual(["obchodné záväzky", "iné"]);
    expect(cardList("[a, b]")).toEqual(["a", "b"]);
    expect(cardList("[]")).toEqual([]);
    expect(cardList("[{{OBLAST}}]")).toEqual([]);
  });

  test("M001 procesný: spor + súd + značka, bez IP a korporátneho bloku", () => {
    const v = buildMatterViews(matter("Klienti/C001/Spisy/M001", M001_CARD, M001_RECORDS), TODAY);
    expect(v.families).toEqual(["procedural"]);
    expect(v.workKind).toBe("dispute");
    expect(v.reasons.map((r) => r.via)).toEqual(expect.arrayContaining(["work_kind", "court", "case_number"]));
    const procedural = block(v, "procedural");
    expect(items(procedural, "court")[0]).toMatchObject({ label: "SYN testový súd", source: { file: "Klienti/C001/Spisy/M001/matter.md", field: "sud", updated: "2026-10-17" } });
    expect(items(procedural, "case_number")[0]?.label).toBe("SYN-M001/2026");
    // Navrhnutý dôkaz nie je „Návrh“ na schválenie: vlastná značka, bez stavu.
    expect(items(procedural, "evidence")[0]).toMatchObject({ tags: ["evidence:proposed"], source: { file: "Klienti/C001/Spisy/M001/memory/M-E1.md", field: "procedural_status" } });
    // Žiadne lehoty v záznamoch → neevidované, nikdy prázdny zoznam „žiadne“.
    expect(sectionOf(procedural, "deadlines")).toMatchObject({ status: "not_recorded" });
    expect(sectionOf(procedural, "hearings")?.status).toBe("not_recorded");
    expect(v.deadlinesRecorded).toBe(false);
    expect(v.conflicts).toEqual([]);
  });

  test("spoločný základ: klient, strany s rolou, zodpovedná osoba, dokument s cestou, úkony z logu", () => {
    const v = buildMatterViews(matter("Klienti/C001/Spisy/M001", M001_CARD, M001_RECORDS), TODAY);
    expect(items(v.base, "client")[0]).toMatchObject({ label: "SYN Tatran Automatika, s. r. o.", source: { file: "Klienti/C001/client.md", field: "title" } });
    expect(items(v.base, "parties").map((p) => [p.label, p.tags])).toEqual([["SYN Tatran Automatika, s. r. o.", ["role:client"]], ["SYN Partner 001, s. r. o.", ["role:counterparty"]]]);
    expect(items(v.base, "responsible")[0]).toMatchObject({ label: "SYN Advokát 01", source: { field: "advokat" } });
    expect(items(v.base, "documents")[0]).toMatchObject({ label: "01-zmluva.docx", document: "Klienti/C001/Spisy/M001/01_Podklady/IN-001/01-zmluva.docx" });
    expect(items(v.base, "documents")[0]?.state).toBeUndefined();
    const actions = items(v.base, "actions");
    expect(actions[0]).toMatchObject({ state: "executed", tags: ["request"], source: { section: "History" } });
    // Rovnaký riadok histórie viacerých záznamov je jedna položka s počtom.
    expect(actions).toHaveLength(1);
    expect(v.strip.find((s) => s.id === "phase")?.status).toBe("not_recorded");
    expect(v.strip.find((s) => s.id === "status")).toMatchObject({ status: "recorded", items: [{ label: "aktívny" }] });
    // Termíny majú odborné bloky; základ ich pri rozpoznanom type nezdvojuje.
    expect(sectionOf(v.base, "dates")).toBeUndefined();
  });

  test("M003 korporátny (advisory + obchodné spoločnosti): subjekty, vzťahy, listiny, schválenia", () => {
    const v = buildMatterViews(matter("Klienti/C001/Spisy/M003", { matter_kind: "advisory", oblast_prava: '["obchodné spoločnosti"]', spisova_znacka: "", sud: "", description: "Vysporiadanie odchádzajúceho spoločníka" }, [
      ...PARTIES,
      { id: "M3-REL", type: "relation", title: "Podiel spoločníka", fields: { from_subject: '"M-S2"', to_subject: '"M-S1"', relation_kind: '"shareholder"', share: '"30 %"', valid_from: '"2020-01-01"' } },
      { id: "M3-I1", type: "instrument", title: "Zmluva o prevode podielu", fields: { instrument_status: '"draft"', form: '"certified_signature"' } },
      { id: "M3-R1", type: "requirement", title: "Súhlas valného zhromaždenia", fields: { fulfillment_status: '"open"', demanded_from: '"M-S1"' } },
    ]), TODAY);
    expect(v.families).toEqual(["corporate"]);
    const corporate = block(v, "corporate");
    expect(items(corporate, "entities").map((e) => e.label)).toContain("SYN Tatran Automatika, s. r. o.");
    expect(items(corporate, "ownership")[0]).toMatchObject({ label: "SYN Partner 001, s. r. o. → SYN Tatran Automatika, s. r. o.", tags: ["relation:shareholder"], detail: "30 %" });
    expect(items(corporate, "instruments")[0]).toMatchObject({ state: "proposed", tags: ["instrument:draft", "form:certified_signature"] });
    // Otvorená požiadavka nie je návrh na schválenie.
    expect(items(corporate, "corp_decisions")[0]).toMatchObject({ tags: ["type:requirement", "fulfillment:open"] });
    expect(items(corporate, "corp_decisions")[0]?.state).toBeUndefined();
    expect(items(corporate, "change")[0]).toMatchObject({ label: "Vysporiadanie odchádzajúceho spoločníka", source: { field: "description" } });
  });

  test("M012 bez pamäte: korporátny blok aj základ sú neevidované, nie prázdne", () => {
    const input = matter("Klienti/C004/Spisy/M012", { matter_kind: "advisory", mode: "ongoing", oblast_prava: '["korporátne poradenstvo"]', advokat: "[DOPLNIT]" }, [], { clientTitle: "SYN Lipa Potraviny, s. r. o." });
    const v = buildMatterViews(input, TODAY);
    expect(v.families).toEqual(["corporate"]);
    for (const s of block(v, "corporate")?.sections ?? []) if (s.id !== "change") expect(s.status).toBe("not_recorded");
    expect(sectionOf(v.base, "responsible")).toMatchObject({ status: "not_recorded", where: { file: "Klienti/C004/Spisy/M012/matter.md", field: "advokat" } });
    expect(sectionOf(block(v, "corporate"), "milestones")?.status).toBe("not_recorded");
    expect(v.deadlinesRecorded).toBe(false);
  });

  test("M006 IP: vlastný typ ip_right — práva, vlastníci, územia, prihláška/zápis, obnova, licencia", () => {
    const v = buildMatterViews(matter("Klienti/C002/Spisy/M006", { matter_kind: "advisory", oblast_prava: '["ochranné známky"]' }, [
      ...PARTIES,
      { id: "M6-IP1", type: "ip_right", title: "Slovná ochranná známka SYN HRON", fields: { right_kind: '"trademark"', subject_matter: '"slovné označenie"', owners: '["M-S1"]', territories: '["SK", "EÚ"]', classes: '["9", "42"]', application_no: '"SYN-POZ-0001"', application_date: '"2024-03-01"', registration_no: '"SYN-ZAP-0001"', registration_date: '"2024-09-01"', right_status: '"registered"', licences: '["M6-I1"]', deadlines: '["2034-03-01 Obnova zápisu"]' } },
      { id: "M6-I1", type: "instrument", title: "Licenčná zmluva SYN", fields: { instrument_status: '"signed"', signed_at: '"2025-01-10"' }, history: ["2025-01-10 [request] - Podpis licencie.", "2026-10-17 [request] - Zaradenie."] },
    ]), TODAY);
    expect(v.families).toEqual(["ip"]);
    const ip = block(v, "ip");
    expect(items(ip, "rights")[0]).toMatchObject({ label: "Slovná ochranná známka SYN HRON", tags: ["right:trademark", "right_status:registered"], source: { file: "Klienti/C002/Spisy/M006/memory/M6-IP1.md", field: "right_kind" } });
    expect(items(ip, "owners")[0]?.label).toBe("SYN Tatran Automatika, s. r. o.");
    expect(items(ip, "territories").map((t) => t.label)).toEqual(["SK", "EÚ"]);
    expect(items(ip, "registrations").map((r) => [r.tags, r.label, r.date])).toEqual([[["application"], "SYN-POZ-0001", "2024-03-01"], [["registration"], "SYN-ZAP-0001", "2024-09-01"]]);
    expect(items(ip, "renewals")[0]).toMatchObject({ label: "Obnova zápisu", date: "2034-03-01", source: { field: "deadlines" } });
    expect(items(ip, "licences")[0]).toMatchObject({ label: "Licenčná zmluva SYN", state: "executed" });
    expect(sectionOf(ip, "disputes")?.status).toBe("not_recorded");
    // Lehota obnovy je bežná lehota: evidencia lehôt existuje.
    expect(v.deadlinesRecorded).toBe(true);
  });

  test("M066 IP + spor: oba bloky naraz, spor v IP odkazuje na procesný blok", () => {
    const v = buildMatterViews(matter("Klienti/C022/Spisy/M066", { matter_kind: "dispute", oblast_prava: '["autorské právo"]', spisova_znacka: "SYN-M066/2026", sud: "SYN testový súd" }, [
      ...PARTIES,
      { id: "M66-MAT", type: "matter", title: "Použitie fotografií", fields: { area: '["autorské právo"]' }, history: ["2026-10-01 [filing] - Podaná žaloba (syntetické).", "2026-10-17 [request] - Zaradenie."] },
    ]), TODAY);
    expect(v.families).toEqual(["procedural", "ip"]);
    expect(items(block(v, "ip"), "disputes")[0]).toMatchObject({ tags: ["procedural_link"], label: "SYN-M066/2026" });
    expect(items(block(v, "procedural"), "filings")[0]).toMatchObject({ label: "Podaná žaloba (syntetické).", state: "executed", date: "2026-10-01" });
    expect(v.reasons.some((r) => r.via === "history" && r.value === "filing")).toBe(true);
  });

  test("oblasti kancelárie z okf.config a starší onboarding `kind`", () => {
    const v = buildMatterViews(matter("Klienti/C009/2026-01 Ochrana značky", { type: "matter", kind: "contentious", area: "IP", matter_kind: "dispute" }, [], {
      officeAreas: { areas: ["Corporate", "IP", "Pracovne"], file: "Office/okf.config" },
    }), TODAY);
    expect(v.families).toEqual(["procedural", "ip"]);
    expect(v.reasons).toContainEqual(expect.objectContaining({ family: "ip", via: "office_area", value: "IP", source: { file: "Office/okf.config", field: "areas" } }));
  });

  test("oprava používateľom cez tags view:* má prednosť pred rozpoznaním", () => {
    const v = buildMatterViews(matter("Klienti/C001/Spisy/M001", { ...M001_CARD, tags: '["klient-vip", "view:corporate"]' }, M001_RECORDS), TODAY);
    expect(v.override).toBe(true);
    expect(v.families).toEqual(["corporate"]);
    const base = buildMatterViews(matter("Klienti/C001/Spisy/M001", { ...M001_CARD, tags: '["view:base"]' }, M001_RECORDS), TODAY);
    expect(base.families).toEqual([]);
    expect(base.override).toBe(true);
  });
});

describe("rozpory a stav návrh / schválené / vykonané", () => {
  test("karta vs záznam veci a karta klienta: súd, značka, oblasť, klient, protistrana", () => {
    const v = buildMatterViews(matter("Klienti/C001/Spisy/M001", { ...M001_CARD, sud: "SYN iný súd", klient: "SYN Iný klient", protistrana: "SYN Úplne iná protistrana", oblast_prava: '["obchodné spoločnosti"]', kind: "non_contentious" }, M001_RECORDS), TODAY);
    expect(v.conflicts.map((c) => c.field).sort()).toEqual(["area", "client", "counterparty", "court", "work_kind"]);
    const court = items(block(v, "procedural"), "court")[0];
    expect(court).toMatchObject({ label: "SYN iný súd", detail: "SYN testový súd", flags: ["conflict"] });
    const conflict = v.conflicts.find((c) => c.field === "court");
    expect(conflict?.values.map((x) => x.source.file)).toEqual(["Klienti/C001/Spisy/M001/matter.md", "Klienti/C001/Spisy/M001/memory/M-MAT.md"]);
    expect(items(v.base, "client")[0]?.flags).toEqual(["conflict"]);
  });

  test("tvrdenie o vykonaní bez zápisu v logu ostáva neoverené (napr. veta z chatu)", () => {
    const executed = record({ id: "E", type: "evidence", title: "Výsluch svedka", fields: { procedural_status: '"taken"' }, history: ["2026-10-20 [hearing] - Svedok vypočutý."], updated: "2026-10-20" });
    const claimedOnly = record({ id: "F", type: "evidence", title: "Znalecký posudok", fields: { procedural_status: '"taken"' }, history: ["2026-09-01 [request] - Vytvorenie."], updated: "2026-10-20" });
    const doneTask = record({ id: "T", type: "task", title: "Podať odvolanie", fields: { state: '"done"' }, history: ["2026-09-01 [request] - Vytvorenie."], updated: "2026-10-21" });
    const generated = record({ id: "G", type: "decision", title: "Návrh postupu", fields: { generated: "{ by: agent, at: 2026-10-20 }" } });
    const final = record({ id: "I", type: "instrument", title: "Zmluva", fields: { instrument_status: '"final"' } });
    expect(recordState(executed)).toEqual({ state: "executed" });
    expect(recordState(claimedOnly)).toEqual({ state: "unknown", flags: ["unlogged"] });
    expect(recordState(doneTask)).toEqual({ state: "unknown", flags: ["unlogged"] });
    expect(recordState(generated)).toEqual({ state: "proposed" });
    expect(recordState(final)).toEqual({ state: "approved" });
  });

  test("ručný stav: Fáza a Ďalší krok s časom manual_updated; zastaraný je označený", () => {
    const input = matter("Klienti/C001/Spisy/M001", M001_CARD, M001_RECORDS);
    input.manualStatus = readManualStatus("---\nmanual_updated: 2026-10-01\n---\n\n> **Fáza:** Čaká sa na vyjadrenie protistrany\n> **Ďalší krok:** _(čo sa má stať)_\n", input.records, TODAY);
    const v = buildMatterViews(input, TODAY);
    expect(v.strip.find((s) => s.id === "phase")).toMatchObject({ status: "recorded" });
    const phase = v.strip.find((s) => s.id === "phase");
    expect(phase?.status === "recorded" ? phase.items[0] : undefined).toMatchObject({ label: "Čaká sa na vyjadrenie protistrany", flags: ["stale"], source: { file: "Klienti/C001/Spisy/M001/_STATUS.md", section: "Fáza", updated: "2026-10-01" } });
    expect(v.strip.find((s) => s.id === "next_step")?.status).toBe("not_recorded");
  });

  test("lehoty: prázdne pole deadlines je evidencia, chýbajúce pole nie", () => {
    expect(recordsDeadlines({ path: "M", records: [record({ id: "A", type: "task", title: "x" })] })).toBe(false);
    expect(recordsDeadlines({ path: "M", records: [record({ id: "A", type: "task", title: "x", fields: { deadlines: "[]" } })] })).toBe(true);
  });

  test("I-5b: pokrytie lehôt po prípadoch — jeden evidujúci prípad nerobí evidovanými ostatné", () => {
    const withDeadlines = { path: "A", records: [record({ id: "A1", type: "task", title: "x", fields: { deadlines: '["2026-11-01 Lehota"]' } })] };
    const without = { path: "B", records: [record({ id: "B1", type: "task", title: "y" })] };
    expect(deadlineCoverage([withDeadlines, without, { ...without, path: "C" }])).toEqual({ recorded: 1, unrecorded: 2 });
    expect(deadlineCoverage([withDeadlines])).toEqual({ recorded: 1, unrecorded: 0 });
  });

  test("I-1: záznamy kancelárie nezapínajú bloky, nie sú stranami, úlohami ani úkonmi a nerobia lehoty evidovanými", () => {
    const office: Rec[] = [
      { id: "OF-R1", type: "decision", title: "Pravidlo kancelárie", fields: { deadlines: "[]" }, history: ["2026-10-01 [decision] - Rozhodnutie kancelárie.", "2026-10-02 [filing] - Podanie kancelárie."] },
      { id: "OF-S1", type: "subject", title: "SYN Kancelária", fields: { role: '"client"' } },
      { id: "OF-T1", type: "task", title: "Úloha kancelárie", fields: { state: '"pending"', due: '"2026-11-01"' } },
      { id: "OF-D1", type: "task", title: "Lehota kancelárie", fields: { deadlines: '["2026-11-02 Termín kancelárie"]' } },
    ];
    const input = matter("Klienti/C003/Spisy/M100", { matter_kind: "advisory", oblast_prava: '["pracovné právo"]' }, [{ id: "M-S9", type: "subject", title: "SYN Klient" }, ...office]);
    input.recordFiles = { ...input.recordFiles, ...Object.fromEntries(office.map((r) => [r.id, `Office/memory/${r.id}.md`])) };
    const v = buildMatterViews(input, TODAY);
    expect(v.families).toEqual([]);
    expect(v.reasons).toEqual([]);
    expect(items(v.base, "parties").map((p) => p.label)).toEqual(["SYN Klient"]);
    expect(JSON.stringify(v)).not.toContain("Úloha kancelárie");
    expect(JSON.stringify(v)).not.toContain("Rozhodnutie kancelárie");
    expect(v.deadlinesRecorded).toBe(false);
    expect(recordsDeadlines(input)).toBe(false);
    // Lehota kancelárie ostane viditeľná, ale označená ako kancelárska.
    expect(items(v.base, "dates").find((d) => d.label === "Termín kancelárie")).toMatchObject({ tags: ["scope:office"], source: { file: "Office/memory/OF-D1.md" } });
  });

  test("I-6: História AI návrhu nie je vykonaný úkon a blok Konanie nezapína", () => {
    const v = buildMatterViews(matter("Klienti/C001/Spisy/M200", { matter_kind: "advisory" }, [
      { id: "AI-1", type: "decision", title: "Návrh podania", fields: { generated: "{ by: agent, at: 2026-10-20 }" }, history: ["2026-10-20 [filing] - Podaná žaloba (tvrdenie agenta)."] },
    ]), TODAY);
    expect(v.families).toEqual([]);
    expect(items(v.base, "actions")[0]).toMatchObject({ label: "Podaná žaloba (tvrdenie agenta).", state: "proposed" });
    const forced = buildMatterViews(matter("Klienti/C001/Spisy/M200", { matter_kind: "dispute" }, [
      { id: "AI-1", type: "decision", title: "Návrh podania", fields: { generated: "{ by: agent, at: 2026-10-20 }" }, history: ["2026-10-20 [filing] - Podaná žaloba (tvrdenie agenta)."] },
    ]), TODAY);
    expect(items(block(forced, "procedural"), "filings")[0]?.state).toBe("proposed");
  });

  test("I-4: odkaz na dokument len v priečinku prípadu alebo jeho klienta", () => {
    const roots = ["Klienti/C001/Spisy/M001", "Klienti/C001"];
    const file = "Klienti/C001/Spisy/M001/memory/E1.md";
    expect(resolveDocument(file, "../01_Podklady/x.pdf", roots)).toBe("Klienti/C001/Spisy/M001/01_Podklady/x.pdf");
    expect(resolveDocument(file, "../../../01_Podklady/spolocne.pdf", roots)).toBe("Klienti/C001/01_Podklady/spolocne.pdf");
    expect(resolveDocument(file, "../../../../C002-iny/Spisy/M006/01_Podklady/x.pdf", roots)).toBeUndefined();
    expect(resolveDocument(file, "../../../../../Office/memory/RULE.md", roots)).toBeUndefined();
    expect(resolveDocument(file, "/etc/passwd", roots)).toBeUndefined();
    const v = buildMatterViews(matter("Klienti/C001/Spisy/M001", M001_CARD, [{ id: "E9", type: "evidence", title: "Cudzí", fields: { "sources:\n  - title": '"x.pdf"\n    resource: "../../../../C002/Spisy/M006/x.pdf"' } }]), TODAY);
    expect(items(v.base, "documents")[0]).toMatchObject({ label: "x.pdf" });
    expect(items(v.base, "documents")[0]?.document).toBeUndefined();
  });

  test("prípad otvorený priamo ako koreň (path „“) dostane odkaz na dokument vo svojom priečinku (#223)", () => {
    const evidence = (resource: string): Rec => ({ id: "E1", type: "evidence", title: "Podklad", fields: { "sources:\n  - title": `"x.pdf"\n    resource: "${resource}"` } });
    const root = (resource: string) => buildMatterViews({
      ...matter("", M001_CARD, [evidence(resource)]),
      cardPath: "matter.md", recordFiles: { E1: "memory/E1.md" }, scopePaths: [""], clientTitle: undefined, clientCardPath: undefined,
    }, TODAY);
    expect(items(root("../01_Podklady/x.pdf").base, "documents")[0]?.document).toBe("01_Podklady/x.pdf");
    // Mimo koreňa pracovného priestoru odkaz nevznikne.
    expect(items(root("../../iny/x.pdf").base, "documents")[0]?.document).toBeUndefined();
    // Explicitný koreň „“ volajúceho povolí; prázdny zoznam koreňov nič.
    expect(resolveDocument("memory/x.md", "../01/doc.pdf", [""])).toBe("01/doc.pdf");
    expect(resolveDocument("memory/x.md", "../01/doc.pdf", [])).toBeUndefined();
  });
});

describe("oprava typu zápisom do poľa tags karty", () => {
  const CARD = "---\ntype: spis\ntitle: \"X\"\ntags: [\"klient-vip\"]\nupdated: 2026-10-17\n---\n\n# X\n";
  test("mení iba riadok tags a zachová ostatné štítky", () => {
    const next = setCardViewTags(CARD, ["ip", "procedural"]);
    expect(next).toBe(CARD.replace('tags: ["klient-vip"]', 'tags: ["klient-vip","view:procedural","view:ip"]'));
    expect(viewTagsLine(CARD, ["ip", "procedural"])).toBe('tags: ["klient-vip","view:procedural","view:ip"]');
    expect(setCardViewTags(next, null)).toBe(CARD.replace('tags: ["klient-vip"]', 'tags: ["klient-vip"]'));
    expect(setCardViewTags(CARD, [])).toContain('tags: ["klient-vip","view:base"]');
  });
  test("automatické rozpoznanie bez štítkov view:* kartu nemení; tags ako reťazec a s komentárom", () => {
    const plain = "---\ntype: spis\ntitle: X\n---\n";
    expect(setCardViewTags(plain, null)).toBe(plain);
    expect(cardList('"view:ip"')).toEqual(["view:ip"]);
    expect(cardList('["a"] # poznámka')).toEqual(["a"]);
    expect(cardList("[a, b] # poznámka")).toEqual(["a", "b"]);
  });
  test("karta bez tags dostane riadok pred koncom frontmatteru; CRLF a BOM ostanú", () => {
    const crlf = "﻿---\r\ntype: spis\r\ntitle: X\r\n---\r\nbody\r\n";
    expect(setCardViewTags(crlf, ["corporate"])).toBe("﻿---\r\ntype: spis\r\ntitle: X\r\ntags: [\"view:corporate\"]\r\n---\r\nbody\r\n");
  });
  test("blokový zoznam tags sa neprepisuje naslepo", () => {
    expect(() => setCardViewTags("---\ntags:\n  - a\n---\n", ["ip"])).toThrow();
  });
});

// ── nad dočasnou kópiou pieskoviska (ak je na disku) ─────────

const SANDBOX = process.env.LAWOSS_SYNTHETIC_OKF ?? join(homedir(), "LAWOSS-pieskovisko/.zdroj/02_OKF_kancelaria");
const work: string[] = [];
afterEach(() => { for (const dir of work.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function copyMatter(client: string, prefix: string): { root: string; rel: string } {
  const root = mkdtempSync(join(tmpdir(), "okf-views-"));
  work.push(root);
  const clientDir = readdirSync(join(SANDBOX, "Klienti")).find((name) => name.startsWith(client));
  if (!clientDir) throw new Error(`chýba ${client}`);
  cpSync(join(SANDBOX, "Klienti", clientDir), join(root, "Klienti", clientDir), { recursive: true });
  cpSync(join(SANDBOX, "Office"), join(root, "Office"), { recursive: true });
  const matterDir = readdirSync(join(root, "Klienti", clientDir, "Spisy")).find((name) => name.startsWith(prefix));
  if (!matterDir) throw new Error(`chýba ${prefix}`);
  return { root, rel: `Klienti/${clientDir}/Spisy/${matterDir}` };
}

/** Rovnaké vstupy, aké skladá read-model (karta, memory/*.md bez index/log, _STATUS.md, karta klienta). */
function loadMatter(root: string, rel: string): MatterInput {
  const dir = join(root, rel);
  const memory = join(dir, "memory");
  const files = existsSync(memory) ? readdirSync(memory).filter((f) => f.endsWith(".md") && !["index.md", "log.md"].includes(f)).sort() : [];
  const officeMemory = join(root, "Office", "memory");
  const officeFiles = existsSync(officeMemory) ? readdirSync(officeMemory).filter((f) => f.endsWith(".md") && !["index.md", "log.md"].includes(f)).sort() : [];
  const records = [...files.map((f) => parseRecord(readFileSync(join(memory, f), "utf8"))), ...officeFiles.map((f) => parseRecord(readFileSync(join(officeMemory, f), "utf8")))];
  const paths = [...files.map((f) => `${rel}/memory/${f}`), ...officeFiles.map((f) => `Office/memory/${f}`)];
  const clientRel = rel.split("/").slice(0, 2).join("/");
  const input: MatterInput = {
    path: rel, cardPath: `${rel}/matter.md`, cardFrontmatter: parseFrontmatter(readFileSync(join(dir, "matter.md"), "utf8")) ?? {},
    records, recordFiles: Object.fromEntries(records.map((r, i) => [r.id, paths[i]])), scopePaths: [rel, clientRel, "Office"],
    clientCardPath: `${clientRel}/client.md`,
  };
  const clientTitle = parseFrontmatter(readFileSync(join(root, clientRel, "client.md"), "utf8"))?.title;
  if (clientTitle) input.clientTitle = clientTitle;
  if (existsSync(join(dir, "_STATUS.md"))) input.manualStatus = readManualStatus(readFileSync(join(dir, "_STATUS.md"), "utf8"), records, TODAY);
  return input;
}

describe.skipIf(!existsSync(SANDBOX))("syntetická kancelária (dočasná kópia)", () => {
  test("M001 procesný, M003 korporátny, M006 IP, M066 IP + spor, M012 bez pamäte", () => {
    const families = (client: string, prefix: string) => { const { root, rel } = copyMatter(client, prefix); return buildMatterViews(loadMatter(root, rel), TODAY); };
    const m001 = families("C001", "M001");
    expect(m001.families).toEqual(["procedural"]);
    expect(m001.conflicts).toEqual([]);
    expect(m001.deadlinesRecorded).toBe(false);
    expect(sectionOf(block(m001, "procedural"), "deadlines")?.status).toBe("not_recorded");
    expect(m001.strip.find((s) => s.id === "phase")?.status).toBe("not_recorded");
    // Riadky RULE-SYN-01 kancelárie sa do posledných úkonov nepočítajú.
    expect(JSON.stringify(m001)).not.toContain("RULE-SYN-01");
    expect(families("C001", "M003").families).toEqual(["corporate"]);
    expect(families("C002", "M006").families).toEqual(["ip"]);
    expect(families("C022", "M066").families).toEqual(["procedural", "ip"]);
    const m012 = families("C004", "M012");
    expect(m012.families).toEqual(["corporate"]);
    // Bez pamäte: strany len z karty (protistrana), lehoty a úkony neevidované.
    expect(items(m012.base, "parties").every((p) => p.source.file.endsWith("/matter.md"))).toBe(true);
    expect(sectionOf(m012.base, "actions")?.status).toBe("not_recorded");
    expect(sectionOf(block(m012, "corporate"), "milestones")?.status).toBe("not_recorded");
  });

  test("zmena súboru v kópii: rozpor súdu, podanie v logu, IP záznam a lehota obnovy", () => {
    const { root, rel } = copyMatter("C022", "M066");
    const card = join(root, rel, "matter.md");
    writeFileSync(card, readFileSync(card, "utf8").replace('sud: "SYN testový súd"', 'sud: "SYN odvolací súd"'));
    const mat = readdirSync(join(root, rel, "memory")).find((f) => f.endsWith("-MAT.md"));
    if (!mat) throw new Error("chýba MAT");
    const matPath = join(root, rel, "memory", mat);
    writeFileSync(matPath, readFileSync(matPath, "utf8").replace("## History\n", "## History\n\n- 2026-10-21 [filing] - Podaná žaloba (syntetické).").replace(/\n\n\n/g, "\n\n"));
    writeFileSync(join(root, rel, "memory", "M066-IP1.md"), [
      "---", "okf: 0.2", 'id: "M066-IP1"', 'type: "ip_right"', 'title: "Fotografie kampane SYN"', 'description: "Syntetický IP záznam (len test)."', 'layer: "L2"', 'jurisdiction: "sk"', 'status: "active"',
      'created: "2026-10-21"', 'updated: "2026-10-21"', 'right_kind: "copyright"', 'owners: ["M066-S1"]', 'territories: ["SK"]', 'deadlines: ["2026-11-15 Výzva na ukončenie použitia"]', "---", "", "## Truth", "", "Syntetické.", "", "## History", "", "- 2026-10-21 [request] - Založenie.", "",
    ].join("\n"));
    const v = buildMatterViews(loadMatter(root, rel), TODAY);
    expect(v.conflicts.map((c) => c.field)).toEqual(["court"]);
    expect(items(block(v, "procedural"), "filings")[0]).toMatchObject({ state: "executed", date: "2026-10-21" });
    expect(items(block(v, "ip"), "rights")[0]).toMatchObject({ label: "Fotografie kampane SYN", tags: ["right:copyright"] });
    // Výzva nie je obnova: ostáva v lehotách prípadu, nie v termínoch obnovy.
    expect(items(block(v, "procedural"), "deadlines")[0]?.date).toBe("2026-11-15");
    expect(sectionOf(block(v, "ip"), "renewals")?.status).toBe("not_recorded");
    expect(v.deadlinesRecorded).toBe(true);
    // Originál pieskoviska ostal nedotknutý.
    expect(readFileSync(join(SANDBOX, rel, "matter.md"), "utf8")).toContain('sud: "SYN testový súd"');
  });
});
