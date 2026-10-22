/**
 * Prehľad prípadu podľa oblasti a typu práce (alfa2 C2): bloky, zdroje, neevidované stavy,
 * rozpory, oprava typu a poctivé prázdne stavy lehôt v Dnes a na Domove klienta. SSR nad
 * syntetickými vstupmi; nedokazuje natívne otvorenie súboru v pracovnom priestore.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { parseRecord } from "../../../lawoss/okf-pamat/src/record";
import { buildOverview, type MatterInput } from "../../../lawoss/okf/read";
import { buildMatterViews } from "../../../lawoss/okf/views";
import { MatterViewsPanel } from "../src/lawoss/lite/matter-views";
import { LiteMatterView } from "../src/lawoss/lite/pages/matter-page";
import { TodayView } from "../src/lawoss/lite/pages/today-page";
import { ClientOverviewView } from "../src/lawoss/lite/client-overview";
import { shellCs, shellDe, shellEn, shellSk } from "../src/lawoss/i18n/shell";

const TODAY = "2026-10-23";
const html = (node: ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

function rec(id: string, type: string, title: string, fields: string[] = [], history = ["2026-09-01 [request] - Vytvorenie."]) {
  return parseRecord(["---", "okf: 0.2", `id: "${id}"`, `type: "${type}"`, `title: "${title}"`, 'description: "Syntetické."', 'layer: "L2"', 'jurisdiction: "sk"', 'status: "active"', 'created: "2026-09-01"', 'updated: "2026-10-17"', ...fields, "---", "", "## Truth", "", "Syntetické.", "", "## History", "", ...history.map((h) => `- ${h}`), ""].join("\n"));
}
function input(path: string, card: Record<string, string>, records: ReturnType<typeof rec>[]): MatterInput {
  return { path, cardPath: `${path}/matter.md`, cardFrontmatter: { title: "SYN prípad", updated: "2026-10-17", ...card }, records,
    recordFiles: Object.fromEntries(records.map((r) => [r.id, `${path}/memory/${r.id}.md`])), scopePaths: [path, "Klienti/C022"],
    clientTitle: "SYN Michal Lupták Servis", clientCardPath: "Klienti/C022/client.md" };
}

const M066 = input("Klienti/C022/Spisy/M066", { matter_kind: "dispute", oblast_prava: '["autorské právo"]', spisova_znacka: "SYN-M066/2026", sud: "SYN testový súd", advokat: "SYN Advokát 01", tags: "[]" }, [
  rec("M66-S1", "subject", "SYN Michal Lupták Servis", ['role: "client"']),
  rec("M66-MAT", "matter", "Použitie fotografií", ['court: "SYN odvolací súd"'], ["2026-10-01 [filing] - Podaná žaloba (syntetické).", "2026-10-17 [request] - Zaradenie."]),
  rec("M66-E1", "evidence", "Fotografie z kampane", ['procedural_status: "proposed"', "sources:", '  - title: "foto.zip"', '    resource: "../01_Podklady/foto.zip"']),
  rec("M66-IP1", "ip_right", "Fotografie kampane SYN", ['right_kind: "copyright"', 'territories: ["SK"]']),
]);
const M012 = input("Klienti/C004/Spisy/M012", { matter_kind: "advisory", mode: "ongoing", oblast_prava: '["korporátne poradenstvo"]', advokat: "[DOPLNIT]" }, []);

describe("prehľad prípadu podľa typu práce", () => {
  test("IP + spor: základ, Konanie a Duševné vlastníctvo, každá položka so zdrojom a stavom", () => {
    const views = buildMatterViews(M066, TODAY);
    const opened: string[] = [];
    const out = html(<MatterViewsPanel views={views} locale="sk" onOpen={(file) => opened.push(file)} />);
    expect(out).toContain('data-lawoss-views="procedural ip"');
    expect(out).toContain("Rozpoznané zo súborov: Konanie · Duševné vlastníctvo");
    for (const family of ["base", "procedural", "ip"]) expect(out).toContain(`data-lawoss-view="${family}"`);
    expect(out).not.toContain('data-lawoss-view="corporate"');
    // Zdroj je tlačidlo so súborom a časom aktualizácie; dokument dôkazu sa dá otvoriť zvlášť.
    expect(out).toContain('data-lawoss-source="Klienti/C022/Spisy/M066/memory/M66-IP1.md"');
    expect(out).toContain("aktualizované");
    expect(out).toContain('data-lawoss-document="Klienti/C022/Spisy/M066/01_Podklady/foto.zip"');
    expect(out).toContain(">Návrh<");
    expect(out).toContain(">Vykonané<");
    expect(out).toContain("Podaná žaloba (syntetické).");
    // Rozpor súdu medzi kartou a záznamom veci je označený a pomenuje oba súbory.
    expect(out).toContain("Podklady sa rozchádzajú");
    expect(out).toContain('data-field="court"');
    expect(out).toContain('data-flag="conflict"');
    // Lehoty nie sú v záznamoch: neevidované, nie „žiadne“.
    expect(out).toMatch(/data-section="deadlines" data-status="not_recorded"><dt>Lehoty<\/dt><dd><p class="lw-views-missing">Neevidované/);
    expect(out).not.toMatch(/Žiadne lehoty|nič nehorí/);
  });

  test("chýbajúce dáta: M012 bez pamäte ukáže korporátny blok s neevidovanými sekciami", () => {
    const out = html(<MatterViewsPanel views={buildMatterViews(M012, TODAY)} locale="cs" />);
    expect(out).toContain('data-lawoss-view="corporate"');
    expect(out).toContain('data-section="entities" data-status="not_recorded"');
    expect(out).toContain('data-section="responsible" data-status="not_recorded"');
    expect(out).toContain("Neevidováno");
    // Bez onOpen je zdroj len text s cestou, nie tlačidlo.
    expect(out).not.toContain("<button");
  });

  test("bez rozpoznaného typu: veta o základe; oprava ukáže presný riadok zápisu", () => {
    const plain = input("Klienti/C009/Spisy/M100", { matter_kind: "other", oblast_prava: '["pracovné právo"]', tags: '["vip"]' }, []);
    const views = buildMatterViews(plain, TODAY);
    expect(views.families).toEqual([]);
    const out = html(<MatterViewsPanel views={views} locale="en" edit={{ cardFile: "Klienti/C009/Spisy/M100/matter.md", tags: '["vip"]', onSave: async () => {} }} />);
    expect(out).toContain("Type of work not recognized from the files; showing the basics.");
    expect(out).toContain(">Change</button>");
  });

  test("detail prípadu: bloky na záložke Prehľad a neevidované lehoty s nápovedou", () => {
    const overview = buildOverview([M066], TODAY).matters[0]!;
    const out = html(<LiteMatterView matter={overview} cockpit={null} busy={null} error={null} onAction={() => {}} views={buildMatterViews(M066, TODAY)} />);
    expect(out).toContain('data-lawoss-views="procedural ip"');
    expect(out).toContain('data-lawoss-deadlines="unrecorded"');
    expect(out).toContain("No recorded deadlines.");
    expect(out.indexOf("data-lawoss-views")).toBeLessThan(out.indexOf("lw-matter-grid"));
  });
});

describe("poctivé prázdne stavy lehôt (UX P2 Denný prehľad)", () => {
  const empty = { deadlines: [], tasks: [], inputs: [], recent: [] };
  test("Dnes: nula evidovaných lehôt nie je „nič nehorí“", () => {
    const out = html(<TodayView model={empty} locale="sk" evidence={{ complete: true, recorded: false }} />);
    expect(out).toContain("V podkladoch prípadov nie sú evidované žiadne lehoty.");
    expect(out).toContain('data-lawoss-deadlines="unrecorded"');
    expect(out).not.toContain("nič nehorí");
  });
  test("Dnes: neúplné čítanie nie je „nič nehorí“; úplné s evidenciou áno", () => {
    expect(html(<TodayView model={empty} locale="sk" evidence={{ complete: false, recorded: true }} />)).toContain("Nepodarilo sa prečítať všetky podklady");
    expect(html(<TodayView model={empty} locale="sk" evidence={{ complete: true, recorded: true }} />)).toContain("Tento týždeň nič nehorí.");
  });
  test("Domov klienta: neevidované lehoty, úlohy z prípadov rovnako ako Dnes, typ prípadu", () => {
    const overview = buildOverview([M066], TODAY).matters[0]!;
    const out = html(<ClientOverviewView workspaceId="c022" locale="sk" todayIso={TODAY} matters={[overview]} deadlines={[]} soon={0} deadlinesRecorded={false} kinds={{ [overview.path]: "Konanie · Duševné vlastníctvo" }} />);
    expect(out).toContain('data-lawoss-deadlines="unrecorded"');
    expect(out).toContain("Žiadne evidované lehoty.");
    expect(out).toContain("Otvorené úlohy z prípadov");
    expect(out).toContain("rovnaký zoznam ako Dnes");
    expect(out).toContain("Konanie · Duševné vlastníctvo");
  });
});

test("texty prehľadu sú vo všetkých štyroch jazykoch a bez zakázaných pojmov", () => {
  const keys = Object.keys(shellEn).filter((key) => key.startsWith("lawoss.lite.ov_") || ["lawoss.lite.hero_unrecorded", "lawoss.lite.hero_partial", "lawoss.lite.deadlines_unrecorded", "lawoss.lite.deadlines_unrecorded_hint", "lawoss.lite.client_overview_tasks", "lawoss.lite.client_overview_tasks_hint"].includes(key));
  expect(keys.length).toBeGreaterThan(80);
  for (const dict of [shellCs, shellSk, shellDe]) for (const key of keys) expect(dict).toHaveProperty([key]);
  for (const key of keys) {
    expect(shellSk[key as keyof typeof shellSk]).not.toMatch(/\b(vec|veci|spis|projekt|relácia|sesia)\b/i);
    expect(shellCs[key as keyof typeof shellCs]).not.toMatch(/\b(věc|věci|spis|projekt|relace)\b/i);
    expect(shellDe[key as keyof typeof shellDe]).not.toContain("—");
  }
});
