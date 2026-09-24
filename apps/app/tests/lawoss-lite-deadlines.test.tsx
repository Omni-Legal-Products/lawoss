// Review PR #100, body 6–10: Dnes nesmí ukazovat nepravdivý přehled lhůt.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { buildOverview, type MatterInput } from "../../../lawoss/okf/read";
import { buildCockpit } from "../../../lawoss/okf/cockpit";
import { LAYER_OF } from "../../../lawoss/okf-pamat/src/schema.ts";
import type { OkfRecord } from "../../../lawoss/okf-pamat/src/record.ts";
import { buildToday, nextDeadline } from "../src/lawoss/lite/today-model";
import { addDays, formatDay, today } from "../src/lawoss/okf/read-model";
import { OkfPageState } from "../src/lawoss/domains/okf-page";
import { liteStateText } from "../src/lawoss/lite/state-text";
import { LiteMatterView } from "../src/lawoss/lite/pages/matter-page";
import { TodayView } from "../src/lawoss/lite/pages/today-page";

const TODAY = "2026-09-24";
const rec = (id: string, deadlines: string[], status = "active"): OkfRecord => ({
  okf: 1, id, type: "question", title: `lhůta ${id}`, description: "syntetický záznam", layer: LAYER_OF.question,
  jurisdiction: "cz", status, created: TODAY, updated: TODAY, truth: "", timeline: [], deadlines,
});
const html = (node: ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

describe("8: vyřazené záznamy nenesou lhůty", () => {
  test("superseded, void, banned, deprecated → žádná lhůta v přehledu ani v cockpitu", () => {
    const records = ["superseded", "void", "banned", "deprecated"].map((s, i) => rec(`Q-${i}`, ["2026-09-10"], s));
    const inputs: MatterInput[] = [{ path: "AK/A/A/Spisy/A", records: [...records, rec("Q-OK", ["2026-09-28"])] }];
    const overview = buildOverview(inputs, TODAY);
    expect(overview.overdue).toHaveLength(0);
    expect(overview.upcomingDeadlines.map((d) => d.recordId)).toEqual(["Q-OK"]);
    const cockpit = buildCockpit({ ...overview, inputs, problems: [] }, "AK/A/A/Spisy/A", TODAY)!;
    expect([...cockpit.deadlines.confirmed, ...cockpit.deadlines.candidates].map((d) => d.recordId)).toEqual(["Q-OK"]);
  });
});

describe("9: datum lhůty v jiném tvaru se nezahodí", () => {
  const inputs: MatterInput[] = [{ path: "AK/A/A/Spisy/A", records: [rec("Q-T", ["2026-09-25 10:00"]), rec("Q-X", ["25. 9. 2026"]), rec("Q-Y", ["2026-9-25"])] }];
  const overview = buildOverview(inputs, TODAY);
  test("čas se ořízne na den, jiný tvar je označený jako neplatný a není „po lhůtě“", () => {
    expect(overview.upcomingDeadlines.find((d) => d.recordId === "Q-T")).toMatchObject({ date: "2026-09-25" });
    expect(overview.upcomingDeadlines.filter((d) => d.invalid).map((d) => d.recordId).sort()).toEqual(["Q-X", "Q-Y"]);
    expect(overview.overdue).toHaveLength(0);
  });
  test("Dnes ukáže neplatné datum nahoře s „check the date“, nikdy „NaN“", () => {
    const model = buildToday({ ...overview, inputs }, TODAY);
    expect(model.deadlines.slice(0, 2).every((d) => d.invalid)).toBe(true);
    expect(model.deadlines.find((d) => d.recordId === "Q-T")).toMatchObject({ daysLeft: 1 });
    const out = html(<TodayView model={model} locale="en" />);
    expect(out).toContain("check the date");
    expect(out).toContain("25. 9. 2026");
    expect(out).not.toContain("NaN");
  });
});

describe("10: další lhůta a výřez 14 dnů", () => {
  test("nextDeadline přeskočí prošlé a neplatné", () => {
    expect(nextDeadline([{ date: "2025-03-01" }, { date: "x", invalid: true }, { date: "2026-10-15" }], TODAY)).toBe("2026-10-15");
    expect(nextDeadline([{ date: "2025-03-01" }], TODAY)).toBeUndefined();
  });
  test("jiný rok se píše, letošní ne", () => {
    const year = today().slice(0, 4);
    expect(formatDay(`${Number(year) + 1}-10-01`, "cs")).toContain(String(Number(year) + 1));
    expect(formatDay(`${year}-10-01`, "cs")).not.toContain(year);
  });
  test("Věc: pod „14 dnů“ jen po lhůtě a do 14 dnů; lhůta za rok tam není", () => {
    const now = today();
    const inputs: MatterInput[] = [{ path: "AK/A/A/Spisy/A", records: [rec("Q-PAST", [addDays(now, -400)]), rec("Q-SOON", [addDays(now, 3)]), rec("Q-FAR", [addDays(now, 372)])] }];
    const overview = buildOverview(inputs, now);
    const cockpit = buildCockpit({ ...overview, inputs, problems: [] }, "AK/A/A/Spisy/A", now)!;
    const page = html(<LiteMatterView matter={overview.matters[0]!} cockpit={cockpit} busy={null} error={null} onAction={() => {}} />);
    // Jen panel Přehled; „Co víme“ smí záznam ukázat jako fakt.
    const out = page.slice(page.indexOf('id="lite-panel-overview"'), page.indexOf('id="lite-panel-known"'));
    expect(out).toContain("lhůta Q-PAST");
    expect(out).toContain("lhůta Q-SOON");
    expect(out).not.toContain("lhůta Q-FAR");
  });
});

describe("7: dnes podle místního času, ne UTC", () => {
  test("00:30 místního času je už nový den", () => {
    expect(today(new Date(2026, 8, 25, 0, 30))).toBe("2026-09-25");
    expect(today(new Date(2026, 8, 24, 23, 59))).toBe("2026-09-24");
  });
});

describe("6: neúplné načtení se v lite ohlásí i nad načtenými věcmi", () => {
  const inputs: MatterInput[] = [{ path: "AK/A/A/Spisy/A", records: [] }];
  const data = { ...buildOverview(inputs, TODAY), problems: [{ path: "AK/A/A/Spisy/A/memory/Q-1.md", message: "bad frontmatter" }], truncated: false, inputs };
  const base = { connection: "ready" as const, workspace: "Kancelář", error: null, loading: false };
  test("lite: upozornění + obsah, bez surové hlášky", () => {
    const out = html(<OkfPageState {...base} data={data} stateText={liteStateText("en")} rawProblems={false}>{() => "dashboard"}</OkfPageState>);
    expect(out).toContain("Some files could not be read");
    expect(out).toContain("dashboard");
    expect(out).not.toContain("bad frontmatter");
  });
  test("lite: i při useknutém průchodu (truncated)", () => {
    const out = html(<OkfPageState {...base} data={{ ...data, problems: [], truncated: true }} stateText={liteStateText("en")} rawProblems={false}>{() => "dashboard"}</OkfPageState>);
    expect(out).toContain("Some files could not be read");
  });
  test("pro beze změny: žádné nové upozornění", () => {
    const out = html(<OkfPageState {...base} data={data}>{() => "dashboard"}</OkfPageState>);
    expect(out).not.toContain("could not be read");
    expect(out).toContain("dashboard");
  });
});
