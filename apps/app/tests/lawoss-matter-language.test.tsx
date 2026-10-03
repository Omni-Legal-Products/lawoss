import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { t } from "../src/i18n";
import { mattersEn, mattersCs, mattersSk, mattersDe } from "../src/lawoss/i18n/matters";
import { OkfPageState } from "../src/lawoss/domains/okf-page";
import { RealOverview } from "../src/lawoss/domains/prehlad/prehlad-page";
import { RealRegister } from "../src/lawoss/domains/lehoty/lehoty-page";
import { MatterCockpit } from "../src/lawoss/domains/spis/spis-page";
import { formatDay, formatLongDay, type OkfReadResult } from "../src/lawoss/okf/read-model";
import { buildOverview, type MatterInput } from "../../../lawoss/okf/read";
import { buildCockpit } from "../../../lawoss/okf/cockpit";
import type { OkfRecord } from "../../../lawoss/okf-pamat/src/record";

const TODAY = "2026-09-22";
const MATTER_PATH = "AK/T/Testovací klient/Spisy/syntetický spis";
const record: OkfRecord = {
  okf: 1, id: "E-TEST", type: "evidence", title: "Důkaz: pôvodný názov",
  description: "Synthetic test fixture", layer: "L1", jurisdiction: "cz", status: "active",
  created: TODAY, updated: TODAY, truth: "Původní obsah", deadlines: ["2026-09-20", "2026-09-24"],
  sources: [{ title: "záznam E-TEST", resource: "originál.pdf, s. 2" }],
  timeline: [{ date: TODAY, text: "Pôvodný zápis v histórii", kind: "původní štítek" }],
  extra: { generated: { by: "test-agent", at: TODAY } },
};
function fixture(): OkfReadResult {
  const inputs: MatterInput[] = [{
    path: MATTER_PATH,
    cardPath: `${MATTER_PATH}/matter.md`,
    cardFrontmatter: { title: "Klientův názov spisu", spisova_znacka: "TEST 1/2026", sud: "Původní název soudu", jurisdiction: "cz", status: "po termíne" },
    records: [structuredClone(record)],
    recordFiles: { "E-TEST": `${MATTER_PATH}/memory/E-TEST.md` },
  }];
  return { ...buildOverview(inputs, TODAY), inputs, problems: [], truncated: false };
}

// SSR uses useLocale's English server snapshot; real same-mount language changes
// are covered by the browser acceptance check, without mocking React subscriptions.
describe("matter UI language boundary", () => {
  test("renders overview and deadline register without translating case data", () => {
    const data = fixture();
    const before = JSON.stringify(data);
    const overview = renderToStaticMarkup(<MemoryRouter><RealOverview data={data} /></MemoryRouter>);
    const register = renderToStaticMarkup(<RealRegister data={data} />);
    expect(overview).toContain("Active matters");
    expect(overview).toContain("1 matter");
    expect(overview).toContain("Klientův názov spisu");
    expect(overview).toContain("Pôvodný zápis v histórii");
    expect(overview).toContain("po termíne"); // the matter's own status is not a UI enum
    expect(register).toContain("Upcoming");
    expect(register).toContain("Původní název soudu");
    expect(register).toContain(record.title);
    expect(overview + register).not.toContain("lawoss.matters.");
    expect(JSON.stringify(data)).toBe(before);
  });

  test("localizes cockpit enums and generated findings while preserving provenance and source text", () => {
    const data = fixture();
    data.inputs[0].records.push({ ...record, id: "E-NOSOURCE", title: "Tvrzení bez zdroje", sources: [], deadlines: [] });
    const cockpit = buildCockpit(data, MATTER_PATH, TODAY);
    if (!cockpit) throw new Error("Fixture cockpit missing");
    const before = JSON.stringify(cockpit);
    const html = renderToStaticMarkup(<MatterCockpit cockpit={cockpit} now={TODAY} raw={{}} />);
    expect(html).toContain("Requires a lawyer’s attention");
    expect(html).toContain("Matter details");
    expect(html).toContain("AI proposal");
    expect(html).toContain("evidence without a sources field");
    expect(html).toContain("záznam E-TEST"); // a source that resembles generated copy must remain untouched
    expect(html).toContain("originál.pdf, s. 2");
    expect(html).toContain("původní štítek");
    expect(html).toContain("cz");
    expect(html).toContain(MATTER_PATH);
    expect(html).not.toContain("Čaká na pozornosť");
    expect(html).not.toContain("lawoss.matters.");
    expect(JSON.stringify(cockpit)).toBe(before);
  });

  test("distinguishes failed, incomplete and empty memory reads with localized visible states", () => {
    const empty: OkfReadResult = { ...buildOverview([], TODAY), inputs: [], problems: [], truncated: false };
    const render = (data: OkfReadResult | undefined, error: unknown = null) => renderToStaticMarkup(
      <MemoryRouter><OkfPageState connection="ready" workspace="Pracovní složka" data={data} error={error} loading={false}>{() => "unexpected data"}</OkfPageState></MemoryRouter>,
    );
    expect(render(empty)).toContain("does not yet contain any matters with memory");
    expect(render({ ...empty, truncated: true })).toContain("could not be read completely");
    expect(render(undefined, new Error("pôvodná chyba EACCES"))).toContain("Could not load matter memory: pôvodná chyba EACCES");
    expect(render(undefined)).toContain("Loading matter memory");
  });
});

describe("matter translations and calendar dates", () => {
  test("all four dictionaries have complete, matching interpolation contracts", () => {
    const placeholders = (value: string) => (value.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
    for (const dictionary of [mattersCs, mattersSk, mattersDe]) {
      expect(Object.keys(dictionary).sort()).toEqual(Object.keys(mattersEn).sort());
      const localized: Record<string, string> = dictionary;
      for (const [key, value] of Object.entries(mattersEn)) {
        expect(placeholders(localized[key])).toEqual(placeholders(value));
      }
    }
    expect(mattersCs["lawoss.matters.deadlinesTitle"]).toBe("Lhůty");
    expect(mattersSk["lawoss.matters.deadlinesTitle"]).toBe("Lehoty");
    expect(mattersDe["lawoss.matters.deadlinesTitle"]).toBe("Fristen");
  });

  test("zero, one, few and many counts use each language's plural rules", () => {
    for (const [locale, expected] of [
      ["cs", ["0 spisů", "1 spis", "2 spisy", "5 spisů"]],
      ["sk", ["0 spisov", "1 spis", "2 spisy", "5 spisov"]],
      ["en", ["0 matters", "1 matter", "2 matters", "5 matters"]],
      ["de", ["0 Akten", "1 Akte", "2 Akten", "5 Akten"]],
    ] as const) {
      expect([0, 1, 2, 5].map((count) => t("lawoss.matters.matters", locale, { count }))).toEqual([...expected]);
    }
    expect(t("lawoss.matters.filesUnreadable", "cs", { count: 1 })).toBe("1 soubor se nepodařilo přečíst");
    expect(t("lawoss.matters.filesUnreadable", "sk", { count: 2 })).toBe("2 súbory sa nedali prečítať");
    expect(t("lawoss.matters.openTasksCount", "en", { count: 2 })).toBe("2 open tasks");
  });

  test("date-only formatting follows the selected locale and never shifts the calendar day", () => {
    const old = process.env.TZ;
    try {
      for (const timezone of ["Pacific/Honolulu", "Pacific/Kiritimati", "Europe/Prague"]) {
        process.env.TZ = timezone;
        for (const locale of ["cs", "sk", "en", "de"]) {
          const expected = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" }).format(new Date("2026-01-01T00:00:00Z"));
          expect(formatDay("2026-01-01", locale)).toBe(expected);
        }
      }
    } finally {
      if (old === undefined) delete process.env.TZ; else process.env.TZ = old;
    }
    expect(formatLongDay("2026-09-22", "cs")).toContain("září");
    expect(formatLongDay("2026-09-22", "sk")).toContain("septembra");
    expect(formatLongDay("2026-09-22", "en")).toContain("September");
    for (const invalid of ["2026-02-30", "2026-13-01", "2026-09-22T12:00:00Z", "původní datum"]) {
      expect(formatDay(invalid, "cs")).toBe(invalid);
      expect(formatLongDay(invalid, "en")).toBe(invalid);
    }
  });
});
