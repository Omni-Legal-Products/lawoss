import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { buildOverview, type MatterInput } from "../../../lawoss/okf/read";
import { agendaEvents } from "../src/lawoss/lite/agenda-model";
import { TodayView } from "../src/lawoss/lite/pages/today-page";
import { appTodayTasks, buildToday, caseDates, startHere, type AppTask } from "../src/lawoss/lite/today-model";
import { appTaskClient, inPractice, openAppTask } from "../src/lawoss/lite/app-tasks";
import { takePendingTasksPaneRequest } from "../src/react-app/domains/tasks/tasks-pane-request";
import type { OkfScope } from "../src/lawoss/okf/read-model";

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
      ["work", "2026-10-26", "SYN test: zavolať klientovi k prílohe", "SYN Tatran Automatika", "/tasks"],
      ["work", "2026-10-28", "Vyžiadať chýbajúcu prílohu", "Úhrada dodávok", `/vec?vec=${encodeURIComponent(M001)}`],
    ]);
  });

  test("os dní, Začnite tu a Otvorené úlohy ukážu úlohu aplikácie s klientom a odkazom na ňu", () => {
    const model = buildToday(data, TODAY, undefined, tasks);
    const html = renderToStaticMarkup(<MemoryRouter><TodayView model={model} locale="sk" now={new Date(`${TODAY}T09:00:00`)} events={agendaEvents(data, tasks)} /></MemoryRouter>);
    expect(html).toContain('data-lawoss-start="work"');
    expect(html).toContain("Úloha · SYN Tatran Automatika");
    expect(html).toContain('href="/tasks"');
    // Úvod hovorí o termíne z prípadu, nie o úlohe aplikácie; „Termíny z prípadov“ ju neuvádzajú.
    expect(html).not.toContain("Termín z prípadu: SYN test");
    expect(html.match(/data-lawoss-case-dates=""[\s\S]*?<\/ul>/)?.[0] ?? "").not.toContain("SYN test");
    const strip = html.match(/<section class="lw-today-strip".*?<\/section>/)?.[0] ?? "";
    const busy = strip.match(/<li[^>]*data-busy[^>]*>.*?<\/li>/g) ?? [];
    expect(busy[0]).toContain("SYN test: zavolať klientovi k prílohe");
    expect(busy[0]).toContain('href="/tasks"');
  });

  test("review: odkaz otvorí v paneli Úlohy práve túto úlohu", () => {
    const prior = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true, writable: true });
    try {
      expect(openAppTask(undefined)).toBeUndefined();
      openAppTask("tsk_1")?.();
      expect(takePendingTasksPaneRequest()).toEqual({ taskId: "tsk_1" });
    } finally {
      if (prior) Object.defineProperty(globalThis, "window", prior); else Reflect.deleteProperty(globalThis, "window");
    }
  });

  test("review: termín s časom podľa miestneho dňa ako v paneli Úlohy", () => {
    const local = new Date(2026, 9, 26, 0, 30);
    expect(appTodayTasks([app({ dueDate: local.toISOString() })])[0]?.due).toBe("2026-10-26");
    expect(appTodayTasks([app({ dueDate: "2026-10-26" })])[0]?.due).toBe("2026-10-26");
  });

  test("review: len úlohy klientov praxe (a bez projektu), meno z karty klienta", () => {
    const ROOT = "/Users/advokat/AK/Klienti";
    const workspaces = [
      { id: "ws_c001", path: `${ROOT}/C001 SYN Tatran`, name: "C001-syn-tatran", displayNameResolved: "C001-syn-tatran" },
      { id: "ws_ina", path: "/Users/advokat/Ina prax/Klient", name: "Iny" },
    ];
    const scope: OkfScope = { anchor: { ...workspaces[0]!, workspaceType: "local" }, members: [{ workspace: { ...workspaces[0]!, workspaceType: "local" }, prefix: "C001 SYN Tatran" }], practiceRoot: ROOT };
    const belongs = inPractice(workspaces, scope);
    expect([app(), app({ projectId: "ws_ina" }), app({ projectId: null }), app({ projectId: "ws_neznamy" })].map(belongs)).toEqual([true, false, true, false]);
    const client = appTaskClient(workspaces, scope, [{ path: "C001 SYN Tatran", title: "SYN Tatran Automatika" }]);
    expect(client("ws_c001")).toBe("SYN Tatran Automatika");
    expect(appTaskClient(workspaces, scope, [])("ws_c001")).toBe("C001-syn-tatran");
    expect(client("ws_neznamy")).toBeUndefined();
  });
});

