// Plán OKF pamäte 4. 10., úlohy 8 a 9: Pro súčty bez dvojitého počítania a pomenované úrovne rozsahu.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { buildOverview, scopeLevels, type MatterInput } from "../../../lawoss/okf/read";
import { buildCockpit } from "../../../lawoss/okf/cockpit";
import { LAYER_OF } from "../../../lawoss/okf-pamat/src/schema.ts";
import type { OkfRecord } from "../../../lawoss/okf-pamat/src/record.ts";
import { LiteMatterView } from "../src/lawoss/lite/pages/matter-page";
import { MatterCockpit } from "../src/lawoss/domains/spis/spis-page";

const TODAY = "2026-10-04";
const rec = (id: string, deadlines: string[]): OkfRecord => ({
  okf: 1, id, type: "question", title: `Otázka ${id}`, description: "syntetický záznam", layer: LAYER_OF.question,
  jurisdiction: "cz", status: "active", created: TODAY, updated: TODAY, truth: "", timeline: [], deadlines,
});

describe("8: Pro súčty počítajú zdieľaný záznam raz", () => {
  test("lehota z kancelárie v dvoch veciach je v súčtoch jedna", () => {
    const shared = rec("Q-OFF", ["2026-10-06", "2026-10-01"]);
    const own = () => rec("Q-001", ["2026-10-05"]);
    const inputs: MatterInput[] = ["A", "B"].map((m) => ({
      path: `Klienti/ACME/Spisy/${m}`,
      records: [shared, own()],
      recordFiles: { "Q-OFF": "Office/memory/Q-OFF.md", "Q-001": `Klienti/ACME/Spisy/${m}/memory/Q-001.md` },
    }));
    const { totals, upcomingDeadlines, overdue } = buildOverview(inputs, TODAY);
    // Riadky registra ostávajú per vec (každý odkazuje na svoju vec), súčty nie.
    expect(upcomingDeadlines).toHaveLength(4);
    expect(overdue).toHaveLength(2);
    expect(totals.deadlinesWithin7Days).toBe(3); // Q-OFF 6. 10. raz + Q-001 v A aj B
    expect(totals.overdue).toBe(1);
    expect(totals.records).toBe(3);
  });

  test("dve lehoty jedného záznamu v ten istý deň sú dve lehoty", () => {
    const r = rec("Q-001", ["2026-10-06 09:00 jednanie", "2026-10-06 odvolanie"]);
    const { totals } = buildOverview([{ path: "Klienti/ACME/Spisy/A", records: [r] }], TODAY);
    expect(totals.deadlinesWithin7Days).toBe(2);
  });
});

describe("9: úrovne rozsahu vec / klient / kancelária", () => {
  const paths = ["Klienti/ACME/Spisy/A", "Klienti/ACME", "Office"];
  test("scopeLevels pomenuje cesty; bez klienta je druhá cesta kancelária", () => {
    expect(scopeLevels(paths).map((s) => s.level)).toEqual(["matter", "client", "office"]);
    expect(scopeLevels(["Vec", "_kancelaria"]).map((s) => s.level)).toEqual(["matter", "office"]);
  });

  const inputs: MatterInput[] = [{
    path: paths[0]!, records: [], scopePaths: paths,
    inheritedIntakes: [{ scope: "client", path: "Klienti/ACME/VSTUPY.md",
      content: "| ID | Prijaté | Zdroj | Originál | Stav | Záznamy |\n|---|---|---|---|---|---|\n| IN-7 | 2026-10-03 | e-mail | zmluva.pdf | pending | |\n" }],
  }];
  const data = { ...buildOverview(inputs, TODAY), inputs, problems: [] };
  const cockpit = buildCockpit(data, paths[0]!, TODAY);
  if (!cockpit) throw new Error("cockpit missing");

  test("Lite detail veci: úrovne pri cestách a klientsky vstup označený ako klient", () => {
    const out = renderToStaticMarkup(<MemoryRouter><LiteMatterView matter={cockpit.matter} cockpit={cockpit} busy={null} error={null} onAction={() => {}} scopePaths={paths} /></MemoryRouter>);
    expect(out).toContain('data-lawoss-scope="matter"><b>Matter</b> Klienti/ACME/Spisy/A');
    expect(out).toContain('data-lawoss-scope="client"><b>Client</b> Klienti/ACME<');
    expect(out).toContain('data-lawoss-scope="office"><b>Office</b> Office');
    expect(out).toMatch(/data-lawoss-scope="client">.*IN-7.*<span class="lw-ref">Client<\/span>/);
  });

  test("Pro spis: úrovne pri cestách a klientsky vstup v pozornosti", () => {
    const out = renderToStaticMarkup(<MatterCockpit cockpit={cockpit} now={TODAY} raw={{}} scopePaths={paths} />);
    expect(out).toContain('data-lawoss-scope="client"><b>Client</b>');
    expect(out).toContain('data-lawoss-scope="office"><b>Office</b>');
    expect(out).toMatch(/IN-7.*· Client<\/small>/);
  });
});
