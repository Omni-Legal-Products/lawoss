import { describe, expect, test } from "bun:test";
import { pendingInputs } from "../../../lawoss/okf/inputs";
import { attention } from "../../../lawoss/okf/cockpit";
import { buildToday, groupByClient } from "../src/lawoss/lite/today-model";
import { buildOverview, type MatterInput, type MatterOverview, type UpcomingDeadline } from "../../../lawoss/okf/read";
import { LAYER_OF } from "../../../lawoss/okf-pamat/src/schema.ts";
import type { OkfRecord } from "../../../lawoss/okf-pamat/src/record.ts";

const m = (path: string, title: string, extra: Partial<MatterOverview> = {}): MatterOverview => ({
  path, title, deadlines: [], openTasks: [], counts: { records: 0, evidence: 0, subjects: 0 }, ...extra,
});
// Cesty ve tvaru AK/<písmeno>/<klient>/Spisy/<vec> — jediný tvar, který `clientFromPath`
// (lawoss/okf/cockpit.ts) skutečně rozpozná (ověřeno; brief použil neplatný tvar "Klienti/...").
const novak = m("AK/N/Novák Jan/Spisy/Odvolání", "Novák — 14 C 101/2025", {
  openTasks: [{ id: "T-1", title: "Podepsat plnou moc", due: "2026-09-30", file: "AK/N/Novák Jan/memory/T-1.md" }], lastEvent: { date: "2026-09-20", text: "rozsudek" } });
const pracovni = m("AK/N/Novák Jan/Spisy/Pracovní", "Novák — pracovní smlouva", {
  openTasks: [{ id: "T-1", title: "Podepsat plnou moc", due: "2026-09-30", file: "AK/N/Novák Jan/memory/T-1.md" }], lastEvent: { date: "2026-09-22", text: "e-mail" } });
const acme = m("AK/A/ACME s.r.o./Spisy/Převod", "ACME — převod podílu");
const dl = (date: string, matter: MatterOverview): UpcomingDeadline => ({ date, title: "Odvolání", recordId: "D-1",
  matter: { path: matter.path, title: matter.title } });
const input = (path: string, intake: string): MatterInput => ({ path, records: [], intake });

describe("pendingInputs", () => {
  test("vezme jen řádky se stavem pending (sloupce dle templates/spis/VSTUPY.md)", () => {
    const intake = "| ID | Přijato | Zdroj | Originál | Stav | Výsledné záznamy |\n|---|---|---|---|---|---|\n| IN-1 | 2026-09-22 | datová schránka | zprava.pdf | pending | |\n| IN-2 | 2026-09-21 | e-mail | stary.pdf | processed | Q-001 |\n";
    expect(pendingInputs(input("Klienti/X", intake))).toEqual([
      { id: "IN-1", received: "2026-09-22", source: "datová schránka", original: "zprava.pdf", matterPath: "Klienti/X", file: "Klienti/X/VSTUPY.md" }]);
  });
  test("bez VSTUPY.md nic", () => expect(pendingInputs(input("Klienti/X", ""))).toEqual([]));
  test("řádek pending s prázdným ID zůstane (pro kokpit ho vždy ukazoval) — final review I1", () => {
    const intake = "| ID | Přijato | Zdroj | Originál | Stav | Výsledné záznamy |\n|---|---|---|---|---|---|\n|  | 2026-09-22 | e-mail | dopis.pdf | pending | |\n";
    const inp = input("AK/N/Novák Jan/Spisy/Odvolání", intake);
    expect(pendingInputs(inp)).toEqual([
      { id: "", received: "2026-09-22", source: "e-mail", original: "dopis.pdf", matterPath: inp.path, file: `${inp.path}/VSTUPY.md` }]);
    const rows = attention(novak, inp, [], "2026-09-23").filter((row) => row.id.startsWith("vstup:"));
    expect(rows).toEqual([{ id: "vstup:", kind: "záznam", state: "nespracované", title: "Nespracovaný vstup ", detail: "e-mail · dopis.pdf", file: `${inp.path}/VSTUPY.md` }]);
  });
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

describe("buildToday — úkoly se zrušeným záznamem (Review Focus 3)", () => {
  const taskRecord = (id: string, status: string, state?: string): OkfRecord => ({
    okf: 1, id, type: "task", title: `task ${id}`, description: "syntetický záznam",
    layer: LAYER_OF.task, jurisdiction: "cz", status, created: "2026-09-20", updated: "2026-09-20", truth: "", timeline: [], ...(state ? { state } : {}),
  });
  const records = [taskRecord("T-SUP", "superseded"), taskRecord("T-VOID", "void"), taskRecord("T-DONE", "active", "done"), taskRecord("T-ACT", "active")];
  const inputs: MatterInput[] = [
    { path: "AK/S/Superseded s.r.o./Spisy/A", records, recordFiles: { "T-ACT": "AK/S/Superseded s.r.o./memory/T-ACT.md" } },
    { path: "AK/S/Superseded s.r.o./Spisy/B", records: [taskRecord("T-ACT", "active")], recordFiles: { "T-ACT": "AK/S/Superseded s.r.o./memory/T-ACT.md" } },
  ];
  const overview = buildOverview(inputs, "2026-09-23");

  test("superseded, void a hotové úkoly se nezobrazí ani v lite, ani v součtu pro", () => {
    expect(buildToday({ ...overview, inputs }, "2026-09-23").tasks.map((t) => t.id)).toEqual(["T-ACT"]);
    expect(overview.matters[0]!.openTasks.map((t) => t.id)).toEqual(["T-ACT"]);
    // Úkol z jednoho sdíleného souboru (klient) ve dvou věcech je v součtu jeden úkol.
    expect(overview.totals.openTasks).toBe(1);
  });
});
