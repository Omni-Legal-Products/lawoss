import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { buildOverview, type MatterInput } from "../../../lawoss/okf/read";
import { inputFilePath, inputGroups, inputOriginal, isFiled, unfiledInputs } from "../src/lawoss/lite/inputs-model";
import { InputsView } from "../src/lawoss/lite/pages/inputs-page";
import { buildToday } from "../src/lawoss/lite/today-model";
import { clientOverviewLink, liteMatterLink } from "../src/lawoss/lite/links";

// Rozhodnutie MČ 23. 10. 2026 a nález N-A3-2 (test alfa2): „Na zaradenie“ na Dnes ukazovalo 1152 riadkov VSTUPY.md
// so stavom pending, hoci súbory už ležali v prípadoch, so surovým Markdownom a so Zdrojom (e-mail) ako nadpisom.

const TODAY = "2026-10-24";
const HEAD = "| ID | Prijaté | Zdroj | Originál | Stav | Výsledné záznamy |\n| --- | --- | --- | --- | --- | --- |\n";
const row = (id: string, source: string, original: string, state = "pending") => `| ${id} | 2026-10-20 | ${source} | ${original} | ${state} | |\n`;
const CLIENT = "Klienti/C001-syn-tatran";
const M001 = `${CLIENT}/Spisy/M001-uhrada`;
const M002 = `${CLIENT}/Spisy/M002-vady`;
const clientIntake = HEAD
  + row("IN-101", "klient001@example.invalid", "[sken súd 001.pdf](00_Na_zatriedenie/sken%20s%C3%BAd%20001.pdf)")
  + row("IN-102", "klient001@example.invalid / M001", "[02-faktura.pdf](Spisy/M001-uhrada/01_Podklady/IN-102/02-faktura.pdf)")
  + row("IN-103", "telefón", "poznamka.txt")
  + row("IN-104", "e-mail", "[hotovo.pdf](hotovo.pdf)", "done");
const matterIntake = HEAD
  + row("IN-001", "klient001@example.invalid / M001", "[01-zmluva.docx](./01_Podklady/IN-001/01-zmluva%20v2.docx)")
  + row("IN-002", "e-mail", "<./01_Podklady/IN-002/priloha.pdf>")
  + row("IN-003", "e-mail", "[mimo.pdf](../../00_Na_zatriedenie/mimo.pdf)");
const inputs: MatterInput[] = [
  { path: M001, records: [], cardFrontmatter: { title: "Úhrada dodávok" }, intake: matterIntake, inheritedIntakes: [{ content: clientIntake, path: `${CLIENT}/VSTUPY.md`, scope: "client" }], clientTitle: "SYN Tatran Automatika, s. r. o.", scopePaths: [M001, CLIENT] },
  // Ten istý klientsky VSTUPY.md zdedí aj druhý prípad: riadky sa nezdvoja.
  { path: M002, records: [], cardFrontmatter: { title: "Vady haly" }, intake: matterIntake.replace(/IN-00/g, "IN-01"), inheritedIntakes: [{ content: clientIntake, path: `${CLIENT}/VSTUPY.md`, scope: "client" }], clientTitle: "SYN Tatran Automatika, s. r. o.", scopePaths: [M002, CLIENT] },
];
const data = { ...buildOverview(inputs, TODAY), inputs, clients: [{ path: CLIENT, title: "SYN Tatran Automatika, s. r. o." }] };

describe("Na zaradenie: len dokumenty mimo prípadov", () => {
  test("bunka Originál: text odkazu a dekódovaný cieľ, nie surový Markdown", () => {
    expect(inputOriginal("[01-zmluva.docx](./01_Podklady/IN-001/01-zmluva%20v2.docx)")).toEqual({ label: "01-zmluva.docx", target: "./01_Podklady/IN-001/01-zmluva v2.docx" });
    expect(inputOriginal("[](<a b/c.pdf>)")).toEqual({ label: "c.pdf", target: "a b/c.pdf" });
    expect(inputOriginal("zprava.zfo")).toEqual({ label: "zprava.zfo", target: "zprava.zfo" });
    expect(inputOriginal("[zlý](%E0%A4%A)").target).toBe("%E0%A4%A");
  });
  test("cesta súboru voči VSTUPY.md; absolútna, adresa a cesta nad koreň nie sú v žiadnom prípade", () => {
    const at = (original: string, file = `${M001}/VSTUPY.md`) => inputFilePath({ original, file });
    expect(at("[x](./01_Podklady/a.pdf)")).toBe(`${M001}/01_Podklady/a.pdf`);
    expect(at("[x](../../00_Na_zatriedenie/b.pdf)")).toBe(`${CLIENT}/00_Na_zatriedenie/b.pdf`);
    for (const outside of ["/Users/x/a.pdf", "C:\\\\a.pdf", "https://example.invalid/a.pdf", "file:///a.pdf", "[x](../../../../../a.pdf)"]) expect(at(outside)).toBeNull();
    expect(isFiled({ original: "a.pdf", file: "VSTUPY.md" }, [""])).toBe(true);
    expect(isFiled({ original: "a.pdf", file: "VSTUPY.md" }, ["M001"])).toBe(false);
    // Iný prípad s podobným začiatkom mena nie je ten istý priečinok.
    expect(isFiled({ original: "M0010/a.pdf", file: "VSTUPY.md" }, ["M001"])).toBe(false);
  });
  test("pending riadky so súborom v prípade sa nepočítajú; klientske bez prípadu áno, bez opakovania", () => {
    const unfiled = unfiledInputs(data);
    expect(unfiled.map((input) => input.id).sort()).toEqual(["IN-003", "IN-013", "IN-101", "IN-103"]);
    expect(buildToday(data, TODAY).inputs).toEqual(unfiled);
  });
  test("podrobný zoznam: po klientovi a prípade, text odkazu, odkazy na prípad a klienta", () => {
    const groups = inputGroups(data);
    expect(groups.map((group) => [group.client, group.link])).toEqual([["SYN Tatran Automatika, s. r. o.", clientOverviewLink(`client:${CLIENT}`)]]);
    expect(groups[0]!.rows.map((r) => [r.input.id, r.label, r.matter?.title ?? null, r.link])).toEqual([
      ["IN-003", "mimo.pdf", "Úhrada dodávok", liteMatterLink(M001)],
      ["IN-101", "sken súd 001.pdf", null, clientOverviewLink(`client:${CLIENT}`)],
      ["IN-103", "poznamka.txt", null, clientOverviewLink(`client:${CLIENT}`)],
      ["IN-013", "mimo.pdf", "Vady haly", liteMatterLink(M002)],
    ]);
  });
  test("stránka: bez surového Markdownu a %20, nadpis je klient, nie e-mail zo stĺpca Zdroj", () => {
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      const out = renderToStaticMarkup(<MemoryRouter><InputsView groups={inputGroups(data)} locale={locale} /></MemoryRouter>);
      expect(out).toContain('data-lawoss-lite="inputs"');
      expect(out).toContain(">SYN Tatran Automatika, s. r. o.<");
      expect(out).toContain("sken súd 001.pdf");
      for (const raw of ["](", "%20", "%C3", "example.invalid"]) expect(out.includes(raw) ? raw : null).toBeNull();
    }
    expect(renderToStaticMarkup(<MemoryRouter><InputsView groups={[]} locale="sk" /></MemoryRouter>)).toContain("Nič nečaká na zaradenie.");
  });
});
