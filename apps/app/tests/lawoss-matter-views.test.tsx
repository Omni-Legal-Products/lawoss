/**
 * Prehľad prípadu podľa oblasti a typu práce (alfa2 C2): stavová lišta, bloky, zdroje, neevidované
 * a nenačítané stavy, rozpory, preklad strojových hodnôt, hranica klienta pri otvorení súboru,
 * zápis opravy typu a poctivé prázdne stavy lehôt v Dnes a na Domove klienta. SSR nad syntetickými
 * vstupmi; nedokazuje natívne otvorenie súboru v pracovnom priestore.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { LegalworkServerError } from "@/app/lib/legalwork-server";
import { parseRecord } from "../../../lawoss/okf-pamat/src/record";
import { buildOverview, isOfficeFile, type MatterInput } from "../../../lawoss/okf/read";
import { buildMatterViews } from "../../../lawoss/okf/views";
import { MatterViewsPanel, type SourceAccess } from "../src/lawoss/lite/matter-views";
import { LiteMatterView } from "../src/lawoss/lite/pages/matter-page";
import { TodayView } from "../src/lawoss/lite/pages/today-page";
import { ClientOverviewView } from "../src/lawoss/lite/client-overview";
import { loadCaseCard, locateCaseFile, saveCaseViewTags } from "../src/lawoss/lite/case-files";
import type { OkfScope } from "../src/lawoss/okf/read-model";
import { shellCs, shellDe, shellEn, shellSk } from "../src/lawoss/i18n/shell";

const TODAY = "2026-10-23";
const html = (node: ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
/** Viditeľný text bez značiek a atribútov (title/aria nesú cesty a polia súborov). */
const visible = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ");

function rec(id: string, type: string, title: string, fields: string[] = [], history = ["2026-09-01 [request] - Vytvorenie."]) {
  return parseRecord(["---", "okf: 0.2", `id: "${id}"`, `type: "${type}"`, `title: "${title}"`, 'description: "Syntetické."', 'layer: "L2"', 'jurisdiction: "sk"', 'status: "active"', 'created: "2026-09-01"', 'updated: "2026-10-17"', ...fields, "---", "", "## Truth", "", "Syntetické.", "", "## History", "", ...history.map((h) => `- ${h}`), ""].join("\n"));
}
function input(path: string, card: Record<string, string>, records: ReturnType<typeof rec>[], client = "Klienti/C022"): MatterInput {
  return { path, cardPath: `${path}/matter.md`, cardFrontmatter: { title: "SYN prípad", updated: "2026-10-17", ...card }, records,
    recordFiles: Object.fromEntries(records.map((r) => [r.id, `${path}/memory/${r.id}.md`])), scopePaths: [path, client],
    clientTitle: "SYN Michal Lupták Servis", clientCardPath: `${client}/client.md` };
}

const M066 = input("Klienti/C022/Spisy/M066", { matter_kind: "dispute", oblast_prava: '["autorské právo"]', spisova_znacka: "SYN-M066/2026", sud: "SYN testový súd", advokat: "SYN Advokát 01", status: "aktívny", tags: "[]" }, [
  rec("M66-S1", "subject", "SYN Michal Lupták Servis", ['role: "client"']),
  rec("M66-MAT", "matter", "Použitie fotografií", ['court: "SYN odvolací súd"'], ["2026-10-01 [filing] - Podaná žaloba (syntetické).", "2026-10-17 [request] - Zaradenie."]),
  rec("M66-E1", "evidence", "Fotografie z kampane", ['procedural_status: "proposed"', "sources:", '  - title: "foto.zip"', '    resource: "../01_Podklady/foto.zip"']),
  rec("M66-IP1", "ip_right", "Fotografie kampane SYN", ['right_kind: "copyright"', 'right_status: "registered"', 'territories: ["SK"]']),
]);
const M012 = input("Klienti/C004/Spisy/M012", { matter_kind: "advisory", mode: "ongoing", oblast_prava: '["korporátne poradenstvo"]', advokat: "[DOPLNIT]" }, [], "Klienti/C004");
const M003 = input("Klienti/C001/Spisy/M003", { matter_kind: "advisory", kind: "contentious", oblast_prava: '["obchodné spoločnosti"]', description: "Vysporiadanie odchádzajúceho spoločníka" }, [
  rec("M3-S1", "subject", "SYN Tatran Automatika, s. r. o.", ['role: "client"', 'person_type: "legal_person"', 'legal_form: "s. r. o."', 'representatives: ["M3-S3"]', 'ubo: ["M3-S3"]']),
  rec("M3-S2", "subject", "SYN Partner 003, s. r. o.", ['role: "counterparty"', 'person_type: "legal_person"']),
  rec("M3-S3", "subject", "SYN Konateľ", ['role: "representative"']),
  rec("M3-REL", "relation", "Podiel", ['from_subject: "M3-S2"', 'to_subject: "M3-S1"', 'relation_kind: "shareholder"', 'share: "30 %"']),
  rec("M3-REL2", "relation", "Štatutár", ['from_subject: "M3-S3"', 'to_subject: "M3-S1"', 'relation_kind: "executive"']),
  rec("M3-I1", "instrument", "Zmluva o prevode podielu", ['instrument_status: "draft"', 'form: "certified_signature"']),
  rec("M3-I2", "instrument", "Dohoda o urovnaní", ['instrument_status: "signed"', 'form: "notarial_deed"'], ["2026-10-17 [request] - Podpis."]),
  rec("M3-R1", "requirement", "Súhlas valného zhromaždenia", ['fulfillment_status: "open"', 'demanded_from: "M3-S1"']),
  rec("M3-D1", "decision", "Rozhodnutie spoločníkov", [], ["2026-10-02 [decision] - Rozhodnutie prijaté.", "2026-10-03 [delivery] - Doručené.", "2026-10-04 [email] - Správa.", "2026-10-05 [call] - Hovor."]),
], "Klienti/C001");

const ws = (id: string, path: string): RouteWorkspace => ({ id, path, name: id, displayNameResolved: id, workspaceType: "local" });
const C022 = ws("c022", "/prax/Klienti/C022");
const C002 = ws("c002", "/prax/Klienti/C002");
const SCOPE: OkfScope = { anchor: C022, practiceRoot: "/prax", members: [{ workspace: C002, prefix: "Klienti/C002" }, { workspace: C022, prefix: "Klienti/C022" }] };
const access = (opened: string[] = []): SourceAccess => ({ canOpen: (file) => locateCaseFile(SCOPE, file, "c022") !== null, open: (file) => { opened.push(file); } });

describe("prehľad prípadu podľa typu práce", () => {
  test("IP + spor: lišta, Základ a Konanie otvorené, Duševné vlastníctvo zbalené; zdroj s časom pri položke", () => {
    const out = html(<MatterViewsPanel views={buildMatterViews(M066, TODAY)} locale="sk" access={access()} />);
    expect(out).toContain('data-lawoss-views="procedural ip"');
    expect(out).toContain("Rozpoznané zo súborov: Konanie · Duševné vlastníctvo");
    expect(out).toContain("data-lawoss-views-strip");
    expect(out).toContain('data-lawoss-view="base"');
    expect(out).toContain('data-lawoss-view="procedural"');
    expect(out).toContain('data-lawoss-view-collapsed="ip"');
    // Najviac dva otvorené bloky, tretí v <details> bez `open`.
    expect(out).toMatch(/<details class="lw-views-collapsed" data-lawoss-view-collapsed="ip"><summary>Duševné vlastníctvo<\/summary>/);
    // Zdroj s časom priamo pri položke; dokument sa dá otvoriť a ↗ má názov.
    expect(out).toContain('data-lawoss-source="Klienti/C022/Spisy/M066/memory/M66-IP1.md"');
    expect(visible(out)).toContain("zdroj · 17. 10. 2026");
    expect(out).toMatch(/data-lawoss-document="Klienti\/C022\/Spisy\/M066\/01_Podklady\/foto.zip" title="Otvoriť dokument: [^"]+" aria-label="Otvoriť dokument: /);
    // Navrhnutý dôkaz má vlastné slovo, nie „Návrh“; podanie z logu je vykonané.
    expect(visible(out)).toContain("navrhnutý dôkaz");
    expect(visible(out)).not.toMatch(/Fotografie z kampane[^|]*Návrh/);
    expect(out).toContain(">Vykonané<");
    // Rozpor súdu, prázdne sekcie zbalené do jedného riadku bez názvov polí.
    expect(out).toContain('data-field="court"');
    expect(out).toContain('data-flag="conflict"');
    expect(visible(out)).toMatch(/Neevidované: [^.]*Lehoty/);
    expect(out).not.toMatch(/Žiadne lehoty|deadlines v záznamoch/);
  });

  test("chýbajúce dáta: M012 má jeden riadok „Neevidované“ na blok, nie desať", () => {
    const out = html(<MatterViewsPanel views={buildMatterViews(M012, TODAY)} locale="cs" />);
    expect(out).toContain('data-lawoss-view="corporate"');
    const lines = out.match(/class="lw-views-missing" data-lawoss-missing=/g) ?? [];
    expect(lines.length).toBe(2);
    expect(visible(out)).toContain("Neevidováno: Společnosti a osoby, Orgány a vlastnictví");
    // Bez prístupu k súborom je zdroj len text, nie tlačidlo.
    expect(out).not.toContain("<button");
  });

  test("I-5c: nečerstvé čítanie klienta hovorí „Nenačítané“, nie „Neevidované“", () => {
    const out = html(<MatterViewsPanel views={buildMatterViews(M012, TODAY)} locale="sk" readState="failed" />);
    expect(visible(out)).toContain("Nenačítané, podklady sa nepodarilo čerstvo prečítať:");
    expect(visible(out)).not.toContain("Neevidované");
    const overview = buildOverview([M066], TODAY).matters[0]!;
    const page = html(<LiteMatterView matter={overview} cockpit={null} busy={null} error={null} onAction={() => {}} views={buildMatterViews(M066, TODAY)} readState="failed" />);
    expect(page).toContain('data-lawoss-deadlines="not_loaded"');
  });

  test("I-3: SK výstup bez anglických strojových hodnôt (vzťahy, listiny, požiadavky, udalosti, Prečo, rozpor)", () => {
    const out = visible(html(<MatterViewsPanel views={buildMatterViews(M003, TODAY)} locale="sk" />));
    for (const word of ["spoločník alebo akcionár", "štatutárny orgán", "konečný užívateľ výhod", "zástupca", "koncept", "úradne osvedčený podpis", "podpísané", "notárska zápisnica",
      "požiadavka", "otvorená", "rozhodnutie", "doručenie", "hovor", "Typ práce", "sporná", "poradenstvo"]) expect(out).toContain(word);
    expect(out).not.toMatch(/\b(shareholder|executive|representative|beneficial|owner|draft|signed|certified|notarial|requirement|decision|delivery|email|call|request|filing|dispute|advisory|contentious|non_contentious|relation|ip_right|view:)\b/i);
    const ip = visible(html(<MatterViewsPanel views={buildMatterViews(M066, TODAY)} locale="sk" />));
    expect(ip).toContain("autorské právo");
    expect(ip).toContain("zapísané");
    expect(ip).not.toMatch(/\b(copyright|registered|filing|request|dispute)\b/i);
  });

  test("bez rozpoznaného typu: veta o základe a termíny v základe; oprava typu ponúknutá", () => {
    const plain = input("Klienti/C009/Spisy/M100", { matter_kind: "other", oblast_prava: '["pracovné právo"]', tags: '["vip"]' }, [], "Klienti/C009");
    const views = buildMatterViews(plain, TODAY);
    expect(views.families).toEqual([]);
    const out = html(<MatterViewsPanel views={views} locale="en" edit={{ cardFile: "Klienti/C009/Spisy/M100/matter.md", load: async () => "", save: async () => {} }} />);
    expect(out).toContain("Type of work not recognized from the files; showing the basics.");
    expect(out).toContain(">Change</button>");
    expect(visible(out)).toContain("Relevant dates");
  });

  test("detail prípadu: register pod prehľadom je zbalený, prehľad je hore", () => {
    const overview = buildOverview([M066], TODAY).matters[0]!;
    const out = html(<LiteMatterView matter={overview} cockpit={null} busy={null} error={null} onAction={() => {}} views={buildMatterViews(M066, TODAY)} />);
    expect(out).toContain('data-lawoss-views="procedural ip"');
    expect(out).toMatch(/<details class="lw-matter-register" data-lawoss-register=""><summary>Detailed register<\/summary>/);
    expect(out.indexOf("data-lawoss-views")).toBeLessThan(out.indexOf("lw-matter-grid"));
    // Bez prehľadu ostáva register otvorený ako doteraz.
    expect(html(<LiteMatterView matter={overview} cockpit={null} busy={null} error={null} onAction={() => {}} />)).not.toContain("data-lawoss-register");
  });
});

describe("I-4: zdroj a dokument len v priečinku klienta prípadu", () => {
  test("súbor iného klienta, kancelárie alebo priečinok sa neotvorí", () => {
    expect(locateCaseFile(SCOPE, "Klienti/C022/Spisy/M066/matter.md", "c022")).toMatchObject({ workspace: { id: "c022" }, path: "Spisy/M066/matter.md" });
    expect(locateCaseFile(SCOPE, "Klienti/C002/Spisy/M006/x.pdf", "c022")).toBeNull();
    expect(locateCaseFile(SCOPE, "Office/memory/RULE-SYN-01.md", "c022")).toBeNull();
    expect(locateCaseFile(SCOPE, "Klienti/C022/Spisy/M066/memory/", "c022")).toBeNull();
    expect(locateCaseFile(null, "Klienti/C022/Spisy/M066/matter.md", "c022")).toBeNull();
    expect(isOfficeFile("Office/memory/RULE-SYN-01.md")).toBe(true);
  });

  test("prípad ako koreň: dokument vo vnorenom registrovanom klientovi sa neotvorí (#223)", () => {
    const matter = ws("m001", "/prax/M001");
    const scope: OkfScope = { anchor: matter, members: [{ workspace: matter, prefix: "", nested: ["C002", "Archív/Č003"] }] };
    expect(locateCaseFile(scope, "01_Podklady/x.pdf", "m001")).toMatchObject({ path: "01_Podklady/x.pdf" });
    expect(locateCaseFile(scope, "C002x/x.pdf", "m001")).toMatchObject({ path: "C002x/x.pdf" });
    for (const file of ["C002/private.pdf", "c002/private.pdf", "C002", "Archív/Č003/x.pdf".normalize("NFD")]) {
      expect(locateCaseFile(scope, file, "m001")).toBeNull();
    }
  });

  test("zdroj kancelárie je text s vysvetlením, nie nefunkčné tlačidlo; dokument iného klienta nemá ↗", () => {
    const withForeign = input("Klienti/C022/Spisy/M066", { matter_kind: "advisory" }, [
      rec("X1", "evidence", "Cudzí podklad", ["sources:", '  - title: "cudzi.pdf"', '    resource: "../../../../C002/Spisy/M006/cudzi.pdf"']),
      rec("OF1", "task", "Lehota kancelárie", ['deadlines: ["2026-11-02 Termín kancelárie"]']),
    ]);
    withForeign.recordFiles = { ...withForeign.recordFiles, OF1: "Office/memory/OF1.md" };
    const out = html(<MatterViewsPanel views={buildMatterViews(withForeign, TODAY)} locale="sk" access={access()} />);
    expect(out).not.toContain("data-lawoss-document=");
    expect(out).toMatch(/<span class="lw-views-source is-static" data-lawoss-source="Office\/memory\/OF1.md" data-static="" title="Office\/memory\/OF1.md › deadlines je mimo priečinka klienta/);
    expect(out).not.toMatch(/<button[^>]*data-lawoss-source="Office/);
    expect(visible(out)).toContain("kancelária");
  });
});

describe("oprava typu: zápis do karty prípadu", () => {
  const CARD = "---\ntype: spis\ntags: []\n---\n";
  const fakeClient = (write: (body: { path: string; content: string; expectedContent?: string | null }) => Promise<unknown>) => {
    const writes: { workspaceId: string; path: string; content: string; expectedContent?: string | null }[] = [];
    return { writes, client: {
      readWorkspaceFile: async () => ({ content: CARD }),
      writeWorkspaceFile: async (workspaceId: string, body: { path: string; content: string; expectedContent?: string | null }) => { writes.push({ workspaceId, ...body }); return write(body); },
    } };
  };

  test("zapíše presne náhľad: iba riadok tags, s očakávaným obsahom", async () => {
    const { writes, client } = fakeClient(async () => ({ ok: true }));
    expect(await loadCaseCard(SCOPE, "c022", "Klienti/C022/Spisy/M066/matter.md", client)).toBe(CARD);
    await saveCaseViewTags({ scope: SCOPE, workspaceId: "c022", cardPath: "Klienti/C022/Spisy/M066/matter.md", before: CARD, families: ["ip"], revalidate: async () => ({ connection: { client }, workspace: { id: "c022" } }) });
    expect(writes).toEqual([{ workspaceId: "c022", path: "Spisy/M066/matter.md", content: '---\ntype: spis\ntags: ["view:ip"]\n---\n', expectedContent: CARD }]);
  });

  test("karta iného klienta ani zmena priečinka po overení sa nezapíšu", async () => {
    const { writes, client } = fakeClient(async () => ({ ok: true }));
    await expect(loadCaseCard(SCOPE, "c022", "Klienti/C002/Spisy/M006/matter.md", client)).rejects.toThrow("card_outside_client");
    await expect(saveCaseViewTags({ scope: SCOPE, workspaceId: "c022", cardPath: "Klienti/C002/Spisy/M006/matter.md", before: CARD, families: ["ip"], revalidate: async () => ({ connection: { client }, workspace: { id: "c022" } }) })).rejects.toThrow("card_outside_client");
    await expect(saveCaseViewTags({ scope: SCOPE, workspaceId: "c022", cardPath: "Klienti/C022/Spisy/M066/matter.md", before: CARD, families: ["ip"], revalidate: async () => ({ connection: { client }, workspace: { id: "c002" } }) })).rejects.toThrow("card_outside_client");
    expect(writes).toEqual([]);
  });

  test("409 (karta sa medzitým zmenila) je chyba bez ďalšieho pokusu ani vynúteného zápisu", async () => {
    const { writes, client } = fakeClient(async () => { throw new LegalworkServerError(409, "conflict", "Konfigurácia sa zmenila."); });
    await expect(saveCaseViewTags({ scope: SCOPE, workspaceId: "c022", cardPath: "Klienti/C022/Spisy/M066/matter.md", before: CARD, families: ["corporate"], revalidate: async () => ({ connection: { client }, workspace: { id: "c022" } }) })).rejects.toBeInstanceOf(LegalworkServerError);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ expectedContent: CARD });
    expect(JSON.stringify(writes[0])).not.toContain("force");
  });
});

describe("poctivé prázdne stavy lehôt (UX P2 Denný prehľad)", () => {
  const empty = { deadlines: [], tasks: [], inputs: [], recent: [] };
  test("Dnes: nula evidovaných lehôt nie je „nič nehorí“", () => {
    const out = html(<TodayView model={empty} locale="sk" evidence={{ complete: true, recorded: 0, unrecorded: 3 }} />);
    expect(out).toContain("V podkladoch prípadov nie sú evidované žiadne lehoty.");
    expect(out).toContain('data-lawoss-deadlines="unrecorded"');
    expect(out).toContain("Lehoty nie sú v podkladoch evidované.");
    expect(out).not.toContain("nič nehorí");
  });
  test("I-5b: jeden z troch prípadov eviduje lehoty — „nič nehorí“ len v evidovaných, s počtom ostatných", () => {
    const out = html(<TodayView model={empty} locale="sk" evidence={{ complete: true, recorded: 1, unrecorded: 2 }} />);
    expect(out).toContain("V evidovaných lehotách tento týždeň nič nehorí. Prípady bez evidovaných lehôt: 2.");
    expect(out).not.toContain("Dobrá chvíľa");
    expect(out).toContain('data-lawoss-deadlines="partial"');
  });
  test("Dnes: neúplné čítanie nie je „nič nehorí“; úplné s evidenciou vo všetkých prípadoch áno", () => {
    const partial = html(<TodayView model={empty} locale="sk" evidence={{ complete: false, recorded: 3, unrecorded: 0 }} />);
    expect(partial).toContain("Nepodarilo sa prečítať všetky podklady");
    expect(partial).toContain('data-lawoss-deadlines="not_loaded"');
    expect(html(<TodayView model={empty} locale="sk" evidence={{ complete: true, recorded: 3, unrecorded: 0 }} />)).toContain("Tento týždeň nič nehorí.");
  });
  test("Domov klienta: neevidované vs nenačítané lehoty, úlohy z prípadov, typ prípadu", () => {
    const overview = buildOverview([M066], TODAY).matters[0]!;
    const view = (extra: { deadlineEvidence?: { recorded: number; unrecorded: number }; readFailed?: boolean }) =>
      html(<ClientOverviewView workspaceId="c022" locale="sk" todayIso={TODAY} matters={[overview]} deadlines={[]} soon={0} kinds={{ [overview.path]: "Konanie · Duševné vlastníctvo" }} {...extra} />);
    const out = view({ deadlineEvidence: { recorded: 0, unrecorded: 1 } });
    expect(out).toContain('data-lawoss-deadlines="unrecorded"');
    expect(out).toContain("Lehoty nie sú v podkladoch evidované.");
    expect(out).toContain("Otvorené úlohy z prípadov");
    expect(out).toContain('title="Zo súborov prípadov, rovnaký zoznam ako Dnes.');
    expect(out).toContain("Konanie · Duševné vlastníctvo");
    expect(view({ readFailed: true })).toContain('data-lawoss-deadlines="not_loaded"');
    expect(view({ deadlineEvidence: { recorded: 1, unrecorded: 0 } })).toContain("Žiadne nadchádzajúce evidované lehoty");
  });
});

test("texty prehľadu sú vo všetkých štyroch jazykoch a bez zakázaných pojmov a názvov polí", () => {
  const keys = Object.keys(shellEn).filter((key) => key.startsWith("lawoss.lite.ov_") || ["lawoss.lite.hero_unrecorded", "lawoss.lite.hero_partial", "lawoss.lite.hero_calm_partial", "lawoss.lite.deadlines_unrecorded", "lawoss.lite.deadlines_unrecorded_hint", "lawoss.lite.deadlines_partial_note", "lawoss.lite.deadlines_not_loaded", "lawoss.lite.client_overview_tasks", "lawoss.lite.client_overview_tasks_hint"].includes(key));
  expect(keys.length).toBeGreaterThan(140);
  for (const dict of [shellCs, shellSk, shellDe]) for (const key of keys) expect(dict).toHaveProperty([key]);
  for (const key of keys) {
    expect(shellSk[key as keyof typeof shellSk]).not.toMatch(/\b(vec|veci|spis|projekt|relácia|sesia|deadlines)\b/i);
    expect(shellCs[key as keyof typeof shellCs]).not.toMatch(/\b(věc|věci|spis|projekt|relace|deadlines)\b/i);
    expect(shellDe[key as keyof typeof shellDe]).not.toContain("—");
  }
});
