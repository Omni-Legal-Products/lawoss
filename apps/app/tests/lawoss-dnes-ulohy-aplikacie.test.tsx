import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { buildOverview, type MatterInput } from "../../../lawoss/okf/read";
import { agendaEvents } from "../src/lawoss/lite/agenda-model";
import { TodayView } from "../src/lawoss/lite/pages/today-page";
import { appTodayTasks, buildToday, caseDates, startHere, type AppTask } from "../src/lawoss/lite/today-model";

// N-A5-4 (UI test dev 25. 10. 2026): úloha z „Nová úloha“ (natívne úlohy aplikácie) s dátumom zajtra sa na Dnes,
// v mesiaci ani na osi neukázala a „Začnite tu“ ostal na neskoršom termíne prípadu.

const TODAY = "2026-10-25";
const M001 = "Klienti/C001 SYN Tatran/Spisy/M001-uhrada";
const inputs: MatterInput[] = [{ path: M001, cardFrontmatter: { title: "Úhrada dodávok" }, records: [{
  okf: 1, id: "M001-T1", type: "task", title: "Vyžiadať chýbajúcu prílohu", description: "syntetický záznam", layer: "L2", jurisdiction: "sk",
  status: "active", created: "2026-10-01", updated: "2026-10-01", truth: "", timeline: [], state: "pending", due: "2026-10-28",
}] }];
const data = { ...buildOverview(inputs, TODAY), inputs };
const app = (over: Partial<AppTask> = {}): AppTask => ({ id: "tsk_1", title: "SYN test: zavolať klientovi k prílohe", status: "open", dueDate: "2026-10-26", projectId: "ws_c001", deletedAt: null, ...over });

describe("N-A5-4: úlohy aplikácie na Dnes", () => {
  const tasks = appTodayTasks([
    app(),
    app({ id: "tsk_done", status: "done" }),
    app({ id: "tsk_cancel", status: "cancelled" }),
    app({ id: "tsk_trash", deletedAt: "2026-10-24T10:00:00Z" }),
    app({ id: "tsk_nodate", title: "Bez dátumu", dueDate: null, projectId: null }),
  ], (projectId) => projectId === "ws_c001" ? "SYN Tatran Automatika" : undefined);

  test("otvorené úlohy aplikácie sú medzi úlohami, hotové, zrušené a v Koši nie", () => {
    expect(tasks.map((task) => [task.key, task.due ?? null, task.app?.client ?? null])).toEqual([
      ["app:tsk_1", "2026-10-26", "SYN Tatran Automatika"],
      ["app:tsk_nodate", null, null],
    ]);
    const model = buildToday(data, TODAY, undefined, tasks);
    expect(model.tasks.map((task) => task.title)).toEqual(["SYN test: zavolať klientovi k prílohe", "Vyžiadať chýbajúcu prílohu", "Bez dátumu"]);
    // Zajtrajšia úloha je skôr ako termín prípadu 28. 10.: „Začnite tu“ ju ukáže prvú.
    const dates = caseDates(model.tasks, TODAY, 14, model.deadlines);
    expect(dates.map((d) => d.due)).toEqual(["2026-10-26", "2026-10-28"]);
    expect(startHere(model.deadlines, dates)).toMatchObject({ kind: "work", item: { id: "tsk_1" } });
  });

  test("mesiac má úlohu ako pracovný termín s odkazom do panela Úlohy", () => {
    const events = agendaEvents(data, tasks);
    expect(events.map((event) => [event.kind, event.date, event.title, event.matter.title, event.link])).toEqual([
      ["work", "2026-10-26", "SYN test: zavolať klientovi k prílohe", "SYN Tatran Automatika", "/tasks?task=tsk_1"],
      ["work", "2026-10-28", "Vyžiadať chýbajúcu prílohu", "Úhrada dodávok", `/vec?vec=${encodeURIComponent(M001)}`],
    ]);
  });

  test("os dní, Začnite tu a Otvorené úlohy ukážu úlohu aplikácie s klientom a odkazom na ňu", () => {
    const model = buildToday(data, TODAY, undefined, tasks);
    const html = renderToStaticMarkup(<MemoryRouter><TodayView model={model} locale="sk" now={new Date(`${TODAY}T09:00:00`)} events={agendaEvents(data, tasks)} /></MemoryRouter>);
    expect(html).toContain('data-lawoss-start="work"');
    expect(html).toContain("Úloha · SYN Tatran Automatika");
    expect(html).toContain('href="/tasks?task=tsk_1"');
    const strip = html.match(/<section class="lw-today-strip".*?<\/section>/)?.[0] ?? "";
    const busy = strip.match(/<li[^>]*data-busy[^>]*>.*?<\/li>/g) ?? [];
    expect(busy[0]).toContain("SYN test: zavolať klientovi k prílohe");
    expect(busy[0]).toContain('href="/tasks?task=tsk_1"');
  });
});
