import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { LAYER_OF } from "../../../lawoss/okf-pamat/src/schema.ts";
import type { OkfRecord } from "../../../lawoss/okf-pamat/src/record.ts";
import { buildOverview, type MatterInput } from "../../../lawoss/okf/read";
import { TodayView } from "../src/lawoss/lite/pages/today-page";
import { buildToday } from "../src/lawoss/lite/today-model";

// N-A5-9 (UI test dev 25. 10. 2026): „Termíny z prípadov“ mali ~132 riadkov (66× „Vyžiadať chýbajúcu prílohu“,
// 66× „Porovnať vyjadrenie protistrany“), každý bez klienta, a „Otvorené úlohy“ ukázali ten istý zoznam druhýkrát.
// Karty „Vaše prípady“ hlásili „Bez bližšej lehoty“, hoci prípad mal termín o 3 dni.

const TODAY = "2026-10-25";
const task = (id: string, title: string, due?: string): OkfRecord => ({
  okf: 1, id, type: "task", title, description: "syntetický záznam", layer: LAYER_OF.task, jurisdiction: "sk", status: "active",
  created: "2026-10-01", updated: "2026-10-20", truth: "", timeline: [], state: "pending", ...(due ? { due } : {}),
});
const inputs: MatterInput[] = Array.from({ length: 20 }, (_, i) => {
  const n = String(i + 1).padStart(3, "0");
  return {
    path: `Klienti/C${n} SYN Klient ${n}/Spisy/M${n} zákazka SYN-${n}`, cardFrontmatter: { title: `zákazka SYN-${n}` }, clientTitle: `SYN Klient ${n}`,
    scopePaths: [`Klienti/C${n} SYN Klient ${n}/Spisy/M${n} zákazka SYN-${n}`, `Klienti/C${n} SYN Klient ${n}`],
    records: [task(`M${n}-T1`, "Vyžiadať chýbajúcu prílohu", "2026-10-28"), task(`M${n}-T2`, "Bez termínu"), task(`M${n}-T3`, "Neskôr", "2026-12-01")],
  };
});
const data = { ...buildOverview(inputs, TODAY), inputs };
const html = renderToStaticMarkup(<MemoryRouter><TodayView model={buildToday(data, TODAY)} locale="sk" now={new Date(`${TODAY}T09:00:00`)} /></MemoryRouter>);
const section = (marker: string) => html.slice(html.indexOf(marker), html.indexOf("</ul>", html.indexOf(marker)));

describe("N-A5-9: Dnes prehľadne", () => {
  test("Termíny z prípadov: najviac 8 riadkov, počet ďalších a meno klienta pri prípade", () => {
    const dates = section("data-lawoss-case-dates");
    expect(dates.match(/data-kind="case-date"/g)).toHaveLength(8);
    expect(dates).toContain('data-lawoss-more="case-dates"');
    expect(dates).toContain("+12 ďalšie");
    expect(dates).toContain("SYN Klient 001 – zákazka SYN-001");
  });

  test("Otvorené úlohy neopakujú termíny do 14 dní a sú skrátené", () => {
    const tasks = html.slice(html.indexOf("Otvorené úlohy</h2>"));
    const list = tasks.slice(0, tasks.indexOf("</ul>"));
    expect(list).not.toContain("Vyžiadať chýbajúcu prílohu");
    expect(list.match(/class="lw-today-task"/g)).toHaveLength(8);
    expect(list).toContain('data-lawoss-more="tasks"');
  });

  test("karta prípadu bez lehoty ukáže najbližší pracovný termín", () => {
    const cards = html.slice(html.indexOf("lw-today-cards"));
    expect(cards).toContain("Najbližší termín");
    expect(cards).toContain("Pracovný termín");
    expect(cards).not.toContain("Bez bližšej lehoty");
  });
});
