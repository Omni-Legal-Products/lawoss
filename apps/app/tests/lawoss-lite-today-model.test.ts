import { describe, expect, test } from "bun:test";
import { pendingInputs } from "../../../lawoss/okf/inputs";
import { buildToday, groupByClient } from "../src/lawoss/lite/today-model";
import type { MatterInput, MatterOverview, UpcomingDeadline } from "../../../lawoss/okf/read";

const m = (path: string, title: string, extra: Partial<MatterOverview> = {}): MatterOverview => ({
  path, title, deadlines: [], openTasks: [], counts: { records: 0, evidence: 0, subjects: 0 }, ...extra,
});
// Cesty ve tvaru AK/<písmeno>/<klient>/Spisy/<vec> — jediný tvar, který `clientFromPath`
// (lawoss/okf/cockpit.ts) skutečně rozpozná (ověřeno; brief použil neplatný tvar "Klienti/...").
const novak = m("AK/N/Novák Jan/Spisy/Odvolání", "Novák — 14 C 101/2025", {
  openTasks: [{ id: "T-1", title: "Podepsat plnou moc", due: "2026-09-30" }], lastEvent: { date: "2026-09-20", text: "rozsudek" } });
const pracovni = m("AK/N/Novák Jan/Spisy/Pracovní", "Novák — pracovní smlouva", {
  openTasks: [{ id: "T-1", title: "Podepsat plnou moc", due: "2026-09-30" }], lastEvent: { date: "2026-09-22", text: "e-mail" } });
const acme = m("AK/A/ACME s.r.o./Spisy/Převod", "ACME — převod podílu");
const dl = (date: string, matter: MatterOverview): UpcomingDeadline => ({ date, title: "Odvolání", recordId: "D-1",
  matter: { path: matter.path, title: matter.title } });
const input = (path: string, intake: string): MatterInput => ({ path, records: [], intake });

describe("pendingInputs", () => {
  test("vezme jen řádky se stavem pending", () => {
    const intake = "| ID | typ | přijato | zdroj | stav |\n|---|---|---|---|---|\n| IN-1 | email | 2026-09-22 | datová schránka | pending |\n| IN-2 | email | 2026-09-21 | e-mail | done |\n";
    expect(pendingInputs(input("Klienti/X", intake))).toEqual([
      { id: "IN-1", received: "2026-09-22", source: "datová schránka", matterPath: "Klienti/X", file: "Klienti/X/VSTUPY.md" }]);
  });
  test("bez VSTUPY.md nic", () => expect(pendingInputs(input("Klienti/X", ""))).toEqual([]));
});

describe("buildToday", () => {
  const result = {
    matters: [novak, pracovni, acme],
    upcomingDeadlines: [dl("2026-09-25", novak), dl("2026-10-20", acme)],
    overdue: [dl("2026-09-20", acme)],
    inputs: [input(novak.path, "| IN-1 | x | 2026-09-22 | DS | pending |")],
  };
  const today = buildToday(result, "2026-09-23");

  test("lhůty: po lhůtě + do 14 dnů, bez vzdálených, seřazené", () => {
    expect(today.deadlines.map((d) => [d.date, d.tier, d.daysLeft])).toEqual([["2026-09-20", "overdue", -3], ["2026-09-25", "soon", 2]]);
  });
  test("sdílený úkol se počítá jednou a nese obě věci (review MČ 22. 9., bod 4)", () => {
    expect(today.tasks).toHaveLength(1);
    expect(today.tasks[0]!.matters.map((x) => x.title)).toEqual(["Novák — 14 C 101/2025", "Novák — pracovní smlouva"]);
  });
  test("nezařazené vstupy a poslední věci podle poslední události", () => {
    expect(today.inputs.map((i) => i.id)).toEqual(["IN-1"]);
    expect(today.recent.map((x) => x.title)).toEqual(["Novák — pracovní smlouva", "Novák — 14 C 101/2025", "ACME — převod podílu"]);
  });
});

describe("groupByClient", () => {
  test("seskupí věci podle klienta, klienti abecedně", () => {
    expect(groupByClient([acme, novak, pracovni]).map((g) => [g.client, g.matters.length])).toEqual([["ACME s.r.o.", 1], ["Novák Jan", 2]]);
  });
});
