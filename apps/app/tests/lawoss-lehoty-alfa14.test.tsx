import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { LAYER_OF, type RecordType } from "../../../lawoss/okf-pamat/src/schema.ts";
import { serializeRecord, type OkfRecord } from "../../../lawoss/okf-pamat/src/record.ts";
import { buildOverview, type MatterInput } from "../../../lawoss/okf/read";
import { deadlineCoverage } from "../../../lawoss/okf/views";
import { liteDeadlines, registerOwnerOf, registerOwns } from "../src/lawoss/domains/lehoty/lehoty-page";
import { clientCounts, GROUP_ROWS, lehotyClients, lehotyGroups, lehotyRows, lehotySummary, matchesKind, ownInputs, undatedTasks, type LehotyRow } from "../src/lawoss/lite/lehoty-model";
import { LehotyDashboard, type LehotyDashboardProps } from "../src/lawoss/lite/lehoty-dashboard";
import { buildToday, groupByClient, type AppTask, type TodayTask } from "../src/lawoss/lite/today-model";
import { agendaEvents, type AgendaEvent } from "../src/lawoss/lite/agenda-model";
import { clientNavModel, overviewFolder } from "../src/lawoss/lite/client-projects";
import { clientDeadlinesLink, liteDeadlineLink, liteMatterLink } from "../src/lawoss/lite/links";
import type { OkfConnection } from "../src/lawoss/okf/connection";
import { okfScope, readScopeMemory, type OkfScopeClient } from "../src/lawoss/okf/read-model";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";

// Spec Lehoty a úlohy v bežnom režime (alfa 14, output/2026-11-14-overenie-alfa12/spec-lehoty.md, časť A).

const TODAY = "2026-11-14";
const M1 = "Klienti/C001-tatran/Spisy/M001-uhrada";
const M2 = "Klienti/C001-tatran/Spisy/M002-bez-lehot";
const task = (id: string, title: string, due?: string): OkfRecord => ({
  okf: 1, id, type: "task", title, description: "syntetický záznam", layer: LAYER_OF.task, jurisdiction: "sk", status: "active",
  created: "2026-09-06", updated: "2026-11-01", truth: "", timeline: [], state: "pending", ...(due ? { due } : {}),
});
const deadline = (id: string, title: string, deadlines: string[], extra: Partial<OkfRecord> = {}): OkfRecord => ({ ...task(id, title), type: "evidence", layer: LAYER_OF.evidence, deadlines, ...extra });
const inputs: MatterInput[] = [
  { path: M1, cardFrontmatter: { title: "Úhrada dodávok" }, records: [
    deadline("M001-E1", "Vyjadrenie k žalobe", ["2026-11-17"]),
    deadline("M001-E2", "Lehota po termíne", ["2026-11-10"]),
    deadline("M001-E3", "Odvolanie o dva mesiace", ["2027-01-20"]),
    deadline("M001-E4", "Neplatná lehota", ["2026-02-30"]),
    task("M001-T1", "Vyžiadať prílohu", "2026-11-12"),
    task("M001-T2", "Poslať kópiu podania", "2026-11-18"),
    task("M001-T3", "Bez termínu"),
    task("M001-T4", "Nečitateľný dátum", "31. 2. 2026"),
  ] },
  { path: M2, cardFrontmatter: { title: "Bez lehôt" }, records: [] },
];
const data = { ...buildOverview(inputs, TODAY), inputs };
const appTask: TodayTask = { key: "app:A1", id: "A1", title: "Úloha appky", due: "2026-11-20", matters: [], app: { client: "Tatran" } };
const model = buildToday(data, TODAY, 36_500, [appTask]);
const candidate: AgendaEvent = { key: "candidate:x", kind: "candidate", date: "2026-11-19", title: "Návrh lehoty", matter: { path: M1, title: "Úhrada dodávok" }, link: liteMatterLink(M1) };
const rows = lehotyRows(model, [...agendaEvents(data, [appTask]), candidate], TODAY);
const byTitle = (title: string): LehotyRow => {
  const row = rows.find((r) => r.title.startsWith(title));
  if (!row) throw new Error(`no row ${title}`);
  return row;
};
const html = (node: ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

describe("riadky a skupiny", () => {
  test("Po termíne / Tento týždeň / Neskôr; neplatné dátumy (lehota aj úloha) navrchu; lehota o 60+ dní nezmizne", () => {
    expect(byTitle("Lehota po termíne").group).toBe("overdue");
    expect(byTitle("Vyžiadať prílohu").group).toBe("overdue");
    expect(byTitle("Vyjadrenie k žalobe").group).toBe("week");
    expect(byTitle("Úloha appky").group).toBe("week");
    expect(byTitle("Odvolanie o dva mesiace").group).toBe("later");
    expect(byTitle("Neplatná lehota").group).toBe("invalid");
    expect(byTitle("Nečitateľný dátum").group).toBe("invalid");
    expect(rows.slice(0, 2).every((row) => row.group === "invalid")).toBe(true);
    expect(rows.some((row) => row.title === "Bez termínu")).toBe(false);
    expect(undatedTasks(model.tasks)).toBe(1);
  });

  test("štítok pôvodu len z modelu: evidovaná, podľa pokynu, pracovný termín, úloha, na potvrdenie", () => {
    expect(byTitle("Vyjadrenie k žalobe").origin).toBe("recorded");
    expect(byTitle("Poslať kópiu podania").origin).toBe("work");
    expect(byTitle("Úloha appky").origin).toBe("task");
    expect(byTitle("Návrh lehoty").origin).toBe("candidate");
    const instruction = { ...data.upcomingDeadlines[0]!, basis: "instruction" as const };
    const own = lehotyRows({ deadlines: buildToday({ ...data, upcomingDeadlines: [instruction], overdue: [] }, TODAY, 36_500).deadlines, tasks: [] }, [], TODAY);
    expect(own[0]!.origin).toBe("instruction");
  });

  test("odkaz: lehota na lehotu v prípade, neplatná na prípad, úloha appky do panela Úlohy", () => {
    expect(byTitle("Vyjadrenie k žalobe").link).toBe(liteDeadlineLink(M1, "M001-E1", "2026-11-17"));
    expect(byTitle("Neplatná lehota").link).toBe(liteMatterLink(M1));
    expect(byTitle("Úloha appky").link).toBe("/tasks");
    expect(byTitle("Úloha appky").appTaskId).toBe("A1");
    expect(byTitle("Vyjadrenie k žalobe").place).toEqual({ matter: "Úhrada dodávok", more: 0 });
  });

  test("filter druhu: Lehoty = lehoty a návrhy, Úlohy = termíny a úlohy appky", () => {
    expect(matchesKind({ kind: "deadline" }, "deadlines")).toBe(true);
    expect(matchesKind({ kind: "candidate" }, "deadlines")).toBe(true);
    expect(matchesKind({ kind: "work" }, "deadlines")).toBe(false);
    expect(matchesKind({ kind: "task" }, "tasks")).toBe(true);
    expect(matchesKind({ kind: "deadline" }, "tasks")).toBe(false);
    const tasks = lehotyGroups(rows, "tasks").flatMap((g) => g.rows.map((r) => r.kind));
    expect(new Set(tasks)).toEqual(new Set(["work", "task"]));
  });

  test("strop osem riadkov na skupinu a „Zobraziť všetky“ rozbalí na mieste; neplatné sa neskryjú", () => {
    const many = Array.from({ length: 11 }, (_, i): LehotyRow => ({ ...byTitle("Odvolanie o dva mesiace"), key: `l${i}` }));
    const invalid = Array.from({ length: 10 }, (_, i): LehotyRow => ({ ...byTitle("Neplatná lehota"), key: `i${i}` }));
    const [inv, later] = lehotyGroups([...invalid, ...many], "all");
    expect([inv!.id, inv!.rows.length, inv!.more]).toEqual(["invalid", 10, 0]);
    expect([later!.id, later!.rows.length, later!.more, later!.total]).toEqual(["later", GROUP_ROWS, 3, 11]);
    expect(lehotyGroups(many, "all", new Set(["later"]))[0]!.rows.length).toBe(11);
  });

  test("tri čísla z tých istých riadkov ako skupiny", () => {
    const summary = lehotySummary(rows);
    expect(summary.overdue).toBe(rows.filter((r) => r.group === "overdue").length);
    expect(summary.week).toBe(lehotyGroups(rows, "all").find((g) => g.id === "week")!.total);
    expect(summary.confirm).toBe(1);
  });
});

describe("obrazovka", () => {
  const base: LehotyDashboardProps = {
    title: "Lehoty a úlohy", locale: "sk", todayIso: TODAY, rows, undated: 1, events: [candidate], clients: [{ id: "tatran", title: "Tatran" }, { id: "hron", title: "Hron" }],
    clientId: null, byClient: [{ id: "tatran", title: "Tatran", count: 4 }], complete: true, coverage: deadlineCoverage(inputs), truncated: 50, unreadable: 2,
    workflow: <section data-test-workflow="" />,
  };
  const out = html(<LehotyDashboard {...base} />);

  test("nadpis s tromi číslami, info v tooltipe, bez odseku textu", () => {
    expect(out).toContain('<h1 class="lw-lehoty-title">Lehoty a úlohy</h1>');
    expect(out).toContain('data-lawoss-count="overdue">2 po termíne</span>');
    expect(out).toMatch(/data-tone="red" data-lawoss-count="overdue"/);
    expect(out).toContain("na potvrdenie");
    expect(out).toContain('title="Dátum sa zobrazuje tak, ako je zapísaný v zázname.');
    expect(out).not.toContain("Register lehôt zo všetkých prípadov");
    expect(out).not.toContain('class="lw-lead"');
  });

  test("skupiny, štítky, filtre; nič z predlohy, čo model nemá; žiadne nové akcie", () => {
    for (const group of ["Overiť dátum", "Po termíne", "Tento týždeň", "Neskôr"]) expect(out).toContain(group);
    expect(out).toContain('aria-pressed="true">Všetko</button>');
    expect(out).toContain('<option value="" selected="">Všetci klienti</option>');
    expect(out).toContain("pracovný termín");
    expect(out).toContain(">úloha<");
    for (const missing of ["z listiny", "návrh asistenta", "Otvoriť v chate", "Odoslať", 'type="checkbox"']) expect(out).not.toContain(missing);
    expect(out).toContain('data-lawoss-undated="1"');
  });

  test("poctivé riadky: #242 prípady bez lehôt, neúplné čítanie, nečitateľné súbory; panel postupu lehôt (#168) pod zoznamom", () => {
    expect(out).toContain('data-lawoss-unrecorded="1"');
    expect(out).toContain("Prípady bez evidovaných lehôt: 1.");
    expect(out).toContain('data-lawoss-truncated="50"');
    expect(out).toContain('data-lawoss-unreadable="2"');
    expect(out.indexOf("data-test-workflow")).toBeGreaterThan(out.indexOf("lw-lehoty-list"));
    expect(out.indexOf("data-test-workflow")).toBeLessThan(out.indexOf("lw-lehoty-side"));
  });

  test("pravý stĺpec: mesiac, návrhy (len ak sú) a „Podľa klienta“ s odkazom na filter", () => {
    expect(out).toContain('data-lawoss-month="compact"');
    expect(out).toContain('data-lawoss-candidates="1"');
    expect(out).toContain(`data-lawoss-client-count="4" href="${clientDeadlinesLink("tatran")}"`);
    const none = html(<LehotyDashboard {...base} events={[]} byClient={undefined} />);
    expect(none).not.toContain("data-lawoss-candidates");
    expect(none).not.toContain("Podľa klienta");
  });

  test("pole chatu: tri návrhy, pri filtri klienta „… tohto klienta“", () => {
    expect(out).toContain(">Čo mám stihnúť tento týždeň?</button>");
    expect(out).toContain(">Skontroluj lehoty</button>");
    expect(out).toContain(">Zapíš lehotu</button>");
    const client = html(<LehotyDashboard {...base} clientId="tatran" byClient={undefined} />);
    expect(client).toContain(">Skontroluj lehoty tohto klienta</button>");
    expect(client).toContain('<option value="tatran" selected="">Tatran</option>');
  });

  test("prázdne: nenačítané nie je „nič“; bez evidovaných lehôt to povie", () => {
    const empty = { ...base, rows: [], undated: 0, events: [], byClient: undefined };
    expect(html(<LehotyDashboard {...empty} complete={false} />)).toContain('data-lawoss-deadlines="not_loaded"');
    expect(html(<LehotyDashboard {...empty} coverage={{ recorded: 0, unrecorded: 2 }} />)).toContain('data-lawoss-deadlines="unrecorded"');
    expect(html(<LehotyDashboard {...empty} />)).toContain("Žiadne lehoty ani úlohy s termínom.");
  });

  test("počas čítania úloh appky čísla po termíne a tento týždeň nie sú nula", () => {
    const pending = html(<LehotyDashboard {...base} pending />);
    expect(pending).not.toContain('data-lawoss-count="overdue"');
    expect(pending).not.toContain('data-lawoss-count="week"');
  });
});

// Ten istý falošný server a prax ako review #246 (lawoss-prehlady-review.test.tsx).
const ROOT = "/Users/advokat/AK Synteticka/Klienti";
const ws = (id: string, path: string): RouteWorkspace => ({ id, path, name: id, displayNameResolved: id, workspaceType: "local" });
const alfa = ws("alfa", `${ROOT}/ALFA STAV s.r.o.`);
const horak = ws("horak", `${ROOT}/Horák s.r.o.`);
const nested = ws("vnoreny", `${ROOT}/ALFA STAV s.r.o./C099 SYN Vnoreny`);
const rec = (type: RecordType, id: string, extra: Partial<OkfRecord> = {}): string => serializeRecord({
  okf: 1, id, type, title: `${type} ${id}`, description: "syntetický záznam", layer: LAYER_OF[type],
  jurisdiction: "sk", status: "active", created: "2026-10-01", updated: "2026-10-01", truth: "Nič.",
  timeline: [{ date: "2026-10-01", text: "založené", kind: "created" }], ...extra,
});
type Tree = Record<string, string>;
function fakeServer(trees: Record<string, Tree>): OkfScopeClient {
  const tree = (id: string): Tree => {
    const files = trees[id];
    if (!files) throw new Error(`404 workspace ${id}`);
    return files;
  };
  return {
    listWorkspaceDirectory: async (id, path) => {
      const prefix = path ? `${path}/` : "";
      const names = new Map<string, "file" | "dir">();
      for (const p of Object.keys(tree(id))) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        names.set(rest.split("/")[0]!, rest.includes("/") ? "dir" : "file");
      }
      if (names.size === 0) throw new Error(`404 ${path}`);
      return { path, truncated: false, entries: [...names].map(([name, kind]) => ({ name, kind, path: `${prefix}${name}` })) };
    },
    readWorkspaceFile: async (id, path) => {
      const content = tree(id)[path];
      if (content === undefined) throw new Error(`404 ${path}`);
      return { path, content, bytes: content.length, updatedAt: 0 };
    },
  };
}
const trees = {
  alfa: {
    "client.md": "---\ntitle: ALFA STAV s.r.o.\nclient_type: po\n---\n",
    "Spisy/2026-03 Spor BETA/matter.md": "---\ntitle: Spor BETA\n---\n",
    "Spisy/2026-03 Spor BETA/memory/E-001-replika.md": rec("evidence", "E-001", { title: "Replika", deadlines: ["2026-11-21"] }),
    "C099 SYN Vnoreny/client.md": "---\ntitle: SYN Vnorený\n---\n",
    "C099 SYN Vnoreny/M001 Cudzí spor/matter.md": "---\ntitle: Cudzí spor\n---\n",
    "C099 SYN Vnoreny/M001 Cudzí spor/memory/E-001-lehota.md": rec("evidence", "E-001", { title: "Lehota vnoreného", deadlines: ["2026-11-22"] }),
  },
  horak: { "client.md": "---\ntitle: Horák s.r.o.\nclient_type: po\n---\n" },
};
async function practice() {
  const workspaces = [alfa, horak, nested];
  const scope = okfScope(workspaces, alfa, ROOT);
  if (!scope) throw new Error("no scope");
  const read = await readScopeMemory(fakeServer(trees), scope, TODAY);
  const groups = groupByClient(read.matters, read.inputs, read.clients ?? []);
  const model = clientNavModel(workspaces, ROOT, { status: "ready", scope, groups, matters: read.matters });
  const connection: OkfConnection = { client: null, baseUrl: "http://127.0.0.1:9", token: "t", workspaces, activeWorkspaceId: "alfa", authGeneration: 1 };
  return { read, scope, workspaces, nav: { connection, scope, data: read, groups, model } };
}
const app = (id: string, projectId: string | null, dueDate = "2026-11-18T10:00:00Z"): AppTask => ({ id, title: `Úloha ${id}`, status: "open", dueDate, projectId, deletedAt: null });

describe("zachované pravidlá: ?klient=, #246, #168", () => {
  test("?klient=: len prípady klienta podľa registerOwns (#246), vnorený klient nie; úlohy appky len jeho projektu", async () => {
    const { read, scope, workspaces, nav } = await practice();
    const out = liteDeadlines({ data: read, scope, clientId: "alfa", nav, appTasks: [app("A", "alfa"), app("B", "horak")], workspaces, todayIso: TODAY });
    expect(out.filtered).toBe(true);
    const titles = out.rows.map((r) => r.title);
    expect(titles).toContain("Replika");
    expect(titles).not.toContain("Lehota vnoreného");
    expect(titles).toContain("Úloha A");
    expect(titles).not.toContain("Úloha B");
    // Podklady a kandidáti len vlastných prípadov; panel postupu lehôt dostane to isté ako register klienta.
    const owns = registerOwns(nav, scope, scope.anchor);
    expect(out.source.inputs.every((input) => owns(overviewFolder(scope, input.path)!))).toBe(true);
    expect(out.own.matters.map((m) => m.title)).toEqual(["Spor BETA"]);
  });

  test("neznámy klient ukáže celý register, ako doteraz", async () => {
    const { read, scope, workspaces, nav } = await practice();
    const out = liteDeadlines({ data: read, scope, clientId: "neznamy", nav, appTasks: [], workspaces, todayIso: TODAY });
    expect(out.filtered).toBe(false);
    expect(out.own).toBe(read);
    expect(out.rows.map((r) => r.title)).toEqual(expect.arrayContaining(["Replika", "Lehota vnoreného"]));
  });

  test("„Podľa klienta“ počíta podľa vlastníka priečinka ako registerOwns: vnorený klient má svoje", async () => {
    const { read, scope, workspaces, nav } = await practice();
    const ownership = registerOwnerOf(nav, scope);
    const folder = (title: string) => overviewFolder(scope, read.matters.find((m) => m.title === title)!.path)!;
    expect(ownership.owner(folder("Cudzí spor"))).toBe("vnoreny");
    expect(ownership.owner(folder("Spor BETA"))).toBe("alfa");
    // Kotva rozsahu v teste je ALFA (ako v review #246); skutočná prax má kotvu v koreni.
    const counts = clientCounts(lehotyRows(buildToday(read, TODAY, 36_500), [], TODAY), lehotyClients(ownership.owners, []),
      (path) => ownership.owner(overviewFolder(scope, path)!), () => null);
    expect(counts.map((c) => [c.id, c.count])).toEqual([["alfa", 1], ["vnoreny", 1]]);
    const all = liteDeadlines({ data: read, scope, clientId: null, nav, appTasks: [app("H", "horak")], workspaces, todayIso: TODAY });
    expect(all.clients.map((c) => c.id)).toEqual(["horak", "vnoreny"]);
    expect(all.byClient?.map((c) => [c.id, c.count])).toEqual([["horak", 1], ["vnoreny", 1]]);
  });

  test("ownInputs nechá len podklady vlastných prípadov", () => {
    const narrowed = ownInputs({ matters: [{ path: "a" }], inputs: [{ path: "a" }, { path: "b" }] });
    expect(narrowed.inputs).toEqual([{ path: "a" }]);
  });

  test("stránka: Pokročilý register bez zmeny, bežný režim s panelom postupu lehôt a vlastným nadpisom", () => {
    const page = readFileSync(new URL("../src/lawoss/domains/lehoty/lehoty-page.tsx", import.meta.url), "utf8");
    expect(page).toContain("? <ClientRegister data={data} scope={scope} workspaceId={client} />");
    expect(page).toContain(": <><DeadlineWorkflowPanel data={data} scope={scope} /><RealRegister data={data} /></>}</OkfPage>;");
    expect(page).toContain("workflow={<DeadlineWorkflowPanel data={derived.own} scope={scope} />}");
    expect(page).toContain("<OkfPage title={lite ? undefined : title} pickWorkspace={pick}>");
    // #168: panel ostáva s dnešnými podmienkami zobrazenia (null, kým postup nie je zapnutý).
    const review = readFileSync(new URL("../src/lawoss/domains/lehoty/deadline-review.tsx", import.meta.url), "utf8");
    expect(review).toContain("if(!connection||!scope||!client||!target)return null;");
  });

  test("vzhľad: dva stĺpce 7fr | 5fr, pod 620 px jeden; reduced motion; bez zvislého zlatého prúžku", () => {
    const css = readFileSync(new URL("../src/lawoss/lite/pages/lehoty.css", import.meta.url), "utf8");
    expect(css).toContain("grid-template-columns: minmax(0, 7fr) minmax(0, 5fr)");
    expect(css).toContain("@container (width < 620px) { .lw-lehoty-cols { grid-template-columns: minmax(0, 1fr); } }");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).not.toMatch(/border-left:[^;]*gold/);
  });
});
