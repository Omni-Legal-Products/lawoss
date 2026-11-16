/**
 * #495: priečinok prípadu premenovaný vo Finderi. Stránka prípadu so starou cestou `?vec=` nebola prázdna bez hlášky:
 * ukáže „Priečinok prípadu … sa nenašiel“, ponúkne prípad s rovnakým číslom v tom istom priečinku a prípady klienta.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiteMatterBody } from "../src/lawoss/lite/pages/matter-page";
import { missingMatter } from "../src/lawoss/lite/missing-matter";
import { liteMatterLink } from "../src/lawoss/lite/links";
import { buildOverview } from "../../../lawoss/okf/read";
import type { OkfReadResult } from "../src/lawoss/okf/read-model";

const CLIENT = "Klienti/C001-syn-alfa";
const OLD = `${CLIENT}/Spisy/M003-vysporiadanie-odchadzajuceho-spolocnika`;
const NEW = `${OLD}-PREMENOVANE`;
const matter = (path: string, title: string) => ({ path, title, deadlines: [], openTasks: [], counts: { records: 0, evidence: 0, subjects: 0 } });
const data = (matters: ReturnType<typeof matter>[]): OkfReadResult => ({ ...buildOverview([], "2026-11-16"), matters, inputs: [], clients: [{ path: CLIENT, title: "SYN Alfa s.r.o." }], problems: [], truncated: false });
const page = (value: OkfReadResult, path = OLD) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[liteMatterLink(path)]}>
  <LiteMatterBody data={value} meta={{ checkedAt: 0, changedAt: 0 }} scope={null} navigate={() => {}} />
</MemoryRouter></QueryClientProvider>);

describe("#495: premenovaný priečinok prípadu", () => {
  test("stará cesta: karta s hláškou, ponuka premenovaného prípadu a prípady klienta (nie prázdna stránka)", () => {
    const html = page(data([matter(NEW, "Vysporiadanie odchádzajúceho spoločníka"), matter(`${CLIENT}/Spisy/M001-iny`, "Iný")]));
    expect(html).toContain("data-lawoss-missing-matter");
    expect(html).toContain("M003-vysporiadanie-odchadzajuceho-spolocnika");
    expect(html).toContain(`href="${liteMatterLink(NEW).replaceAll("&", "&amp;")}"`);
    expect(html).toContain("SYN Alfa s.r.o.");
  });

  test("premenovaný prípad sa ponúkne len pri jedinom prípade s rovnakým číslom v tom istom priečinku", () => {
    const one = missingMatter(OLD, [matter(NEW, "A"), matter(`${CLIENT}/Spisy/M004-x`, "B")], [{ path: CLIENT, title: "SYN Alfa s.r.o." }]);
    expect(one.renamed?.path).toBe(NEW);
    expect(one.client).toEqual({ key: `client:${CLIENT}`, name: "SYN Alfa s.r.o." });
    expect(missingMatter(OLD, [matter(NEW, "A"), matter(`${CLIENT}/Spisy/M003-dalsi`, "C")]).renamed).toBeUndefined();
    expect(missingMatter(OLD, [matter(`Klienti/C002/Spisy/M003-iny-klient`, "D")]).renamed).toBeUndefined();
    expect(missingMatter(`${CLIENT}/Spisy/bez-cisla`, [matter(`${CLIENT}/Spisy/bez-cisla-2`, "E")]).renamed).toBeUndefined();
  });

  test("bez kandidáta aj bez klienta: hláška a odkaz na zoznam klientov", () => {
    const html = page(data([]), "Spisy/M009-nic");
    expect(html).toContain("data-lawoss-missing-matter");
    expect(html).toContain('href="/klienti"');
  });
});
