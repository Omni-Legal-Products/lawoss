import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { TodayView } from "../src/lawoss/lite/pages/today-page";
import { ClientsView } from "../src/lawoss/lite/pages/clients-page";
import { LiteMatterView, matterFromParams } from "../src/lawoss/lite/pages/matter-page";
import { liteMatterLink } from "../src/lawoss/lite/links";
import type { TodayModel } from "../src/lawoss/lite/today-model";
import type { Cockpit } from "../../../lawoss/okf/cockpit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OkfPageState } from "../src/lawoss/domains/okf-page";
import { liteStateText } from "../src/lawoss/lite/state-text";
import { TodayPage } from "../src/lawoss/lite/pages/today-page";
import { ClientsPage } from "../src/lawoss/lite/pages/clients-page";
import { LiteMatterPage } from "../src/lawoss/lite/pages/matter-page";
import { buildOverview } from "../../../lawoss/okf/read";

const BANNED = /workspace|session|skill|\bMCP\b|\bOKF\b|opencode|plugin/i;

const matter = { path: "Klienti/Novák/Spisy/Odvolání", title: "Novák — 14 C 101/2025", matterRef: "14 C 101/2025", court: "OS Praha 2",
  deadlines: [], openTasks: [], counts: { records: 2, evidence: 0, subjects: 1 } };
const model: TodayModel = {
  deadlines: [{ date: "2026-09-25", title: "Odvolání", recordId: "D-1", matter, tier: "soon", daysLeft: 2 }],
  tasks: [{ key: "k", id: "T-1", title: "Podepsat plnou moc", matters: [{ path: matter.path, title: matter.title }] }],
  inputs: [{ id: "IN-1", received: "2026-09-22", source: "datová schránka", original: "zprava.zfo", matterPath: matter.path, file: `${matter.path}/VSTUPY.md` }],
  recent: [matter],
};
const html = (node: ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
// MemoryRouter vykreslí `<Link to>` jako href s procentovým kódováním cesty, bez `#`.
const href = (to: string) => `href="${to}"`;

describe("stránky LAWOSS-lite", () => {
  test("Dnes: lhůta, úkol, vstup k zařazení a odkaz na věc", () => {
    const out = html(<TodayView model={model} locale="en" />);
    expect(out).toContain('data-lawoss-lite="today"');
    expect(out).toContain("Odvolání");
    expect(out).toContain("in 2 days");
    expect(out).toContain("Podepsat plnou moc");
    expect(out).toContain("IN-1");
    expect(out).toContain(href(liteMatterLink(matter.path)));
    expect(out).toContain(href("/experimenty/novy-spis"));
    // pořadí: Lhůty → K zařazení → Úkoly
    expect(out.indexOf("Odvolání")).toBeLessThan(out.indexOf("IN-1"));
    expect(out.indexOf("IN-1")).toBeLessThan(out.indexOf("Podepsat plnou moc"));
  });
  test("Dnes: vstup bez ID ukáže pomlčku (final review I1)", () => {
    const out = html(<TodayView model={{ ...model, inputs: [{ ...model.inputs[0]!, id: "" }] }} locale="en" />);
    expect(out).toContain('<span class="lw-no">—</span>');
  });
  test("Dnes a Klienti: jediný vstup „+ New matter“, žádný duplicitní „New client“ (final review I4)", () => {
    for (const out of [html(<TodayView model={model} locale="en" />), html(<ClientsView groups={[]} />)]) {
      expect(out.split(href("/experimenty/novy-spis")).length - 1).toBe(1);
      expect(out).toContain("+ New matter");
      expect(out).not.toContain("New client");
    }
  });
  test("Dnes: lhůta za 1/2/5 dní gramaticky v en/cs/sk (final review I6)", () => {
    const due = (locale: "en" | "cs" | "sk", daysLeft: number) =>
      html(<TodayView model={{ ...model, deadlines: [{ ...model.deadlines[0]!, daysLeft }] }} locale={locale} />);
    const expected = {
      en: ["tomorrow", "in 2 days", "in 5 days"],
      cs: ["zítra", "za 2 dny", "za 5 dní"],
      sk: ["zajtra", "o 2 dni", "o 5 dní"],
    } as const;
    for (const [locale, [one, two, five]] of Object.entries(expected) as [keyof typeof expected, readonly string[]][]) {
      expect(due(locale, 1)).toContain(`>${one}<`);
      expect(due(locale, 2)).toContain(`>${two}<`);
      expect(due(locale, 5)).toContain(`>${five}<`);
    }
  });
  test("Věc: /vec bez parametru nebo s neznámou cestou nikdy nevybere jinou věc (final review M1)", () => {
    const other = { ...matter, path: "Klienti/Svoboda/Spisy/Nájem", title: "Svoboda — nájem" };
    const matters = [other, matter];
    expect(matterFromParams(matters, new URLSearchParams(""))).toBeNull();
    expect(matterFromParams(matters, new URLSearchParams("vec="))).toBeNull();
    expect(matterFromParams(matters, new URLSearchParams("vec=Klienti/Neexistuje"))).toBeNull();
    expect(matterFromParams(matters, new URLSearchParams(`vec=${encodeURIComponent(matter.path)}`))).toBe(matter);
  });
  test("Dnes: prázdné stavy", () => {
    const out = html(<TodayView model={{ deadlines: [], tasks: [], inputs: [], recent: [] }} locale="en" />);
    expect(out).toContain("No deadlines in the next 14 days.");
    expect(out).toContain("No open tasks.");
    expect(out).toContain("Nothing waiting to be filed.");
  });
  test("Klienti a věci", () => {
    const out = html(<ClientsView groups={[{ client: "Novák Jan", matters: [matter] }]} />);
    expect(out).toContain('data-lawoss-lite="clients"');
    expect(out).toContain("Novák Jan");
    expect(out).toContain(matter.title);
    expect(out).toContain(href(liteMatterLink(matter.path)));
    expect(html(<ClientsView groups={[]} />)).toContain("No clients yet. Create the first one.");
  });
  test("Věc: hlavička, pět rychlých akcí, žádný technický pojem", () => {
    const out = html(<LiteMatterView matter={matter} cockpit={null} busy={null} error={null} onAction={() => {}} />);
    expect(out).toContain('data-lawoss-lite="matter"');
    expect(out).toContain("OS Praha 2");
    for (const label of ["Summarise the file", "Check deadlines", "Prepare a reply", "Add a document", "Verify the client"]) expect(out).toContain(label);
    expect(out).toContain('role="tablist"');
    expect(out).toContain('aria-selected="true"');
    expect(out).not.toMatch(/workspace|session|skill|\bOKF\b/i);
    expect(out).toContain("Nothing recorded yet.");
  });
  test("Věc: běžící akce vypne tlačítka, chyba se ukáže srozumitelně", () => {
    const out = html(<LiteMatterView matter={matter} cockpit={null} busy="summarize" error="boom" onAction={() => {}} />);
    expect(out.match(/<button[^>]*disabled=""[^>]*>(Summarise|Check|Prepare|Add|Verify)/g)?.length).toBe(5);
    expect(out).toContain("The conversation could not be opened. Try again, or use the advanced mode.");
    expect(out).not.toContain("boom");
  });
  test("Věc: přehled ukáže lhůty s označením neověřených a úkoly z paměti", () => {
    const cockpit: Pick<Cockpit, "deadlines" | "tasks" | "attention" | "facts"> = {
      deadlines: {
        confirmed: [{ date: "2026-09-25", title: "Odvolání", recordId: "D-1", provenance: "overené", file: "f", overdue: false, confirmed: true }],
        candidates: [{ date: "2026-09-30", title: "Vyjádření", recordId: "D-2", provenance: "AI návrh", file: "f", overdue: false, confirmed: false }],
      },
      tasks: [{ id: "T-9", title: "Zavolat klientovi", overdue: false, file: "f" }],
      attention: [],
      facts: [{ id: "E-1", title: "Rozsudek doručen 10. 9.", kind: "dôkaz", provenance: "zapísané", file: "f", source: "Rozsudek.pdf" }],
    };
    const out = html(<LiteMatterView matter={matter} cockpit={cockpit} busy={null} error={null} onAction={() => {}} />);
    expect(out).toContain("Vyjádření");
    expect(out).toContain(">check<");
    expect(out).toContain("Zavolat klientovi");
    expect(out).toContain("next deadline");
    expect(out).toContain("What we know");
    expect(out).toContain("Rozsudek doručen 10. 9.");
    expect(out).not.toContain("Nothing recorded yet.");
  });
});

describe("stavy stránek LAWOSS-lite", () => {
  const empty = { ...buildOverview([], "2026-09-20"), problems: [], truncated: false, inputs: [] };
  type StateProps = Omit<Parameters<typeof OkfPageState>[0], "children">;
  const base: StateProps = { connection: "ready", workspace: "Kancelář", error: null, data: empty, loading: false };
  const lite = (props: Partial<StateProps>) => html(<OkfPageState {...base} {...props} stateText={liteStateText("en")}>{() => "dashboard"}</OkfPageState>);

  test("celé lite stránky při startu: načítání a znovu, bez technických pojmů", () => {
    for (const Page of [TodayPage, ClientsPage, LiteMatterPage]) {
      const out = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter><Page /></MemoryRouter></QueryClientProvider>);
      expect(out).toContain("Loading your matters…");
      expect(out).toContain("Try again");
      // Navigace LawossLayout je pro chrome (lite shell řeší Task 6); kontrolujeme obsah stránky.
      const sheet = out.slice(out.indexOf('<section class="lw-sheet">'));
      expect(sheet).toContain("Loading your matters…");
      expect(sheet).not.toMatch(BANNED);
    }
  });
  test("načítání / bez připojení / bez složky / prázdná složka / chyba", () => {
    const cases: [Partial<StateProps>, string][] = [
      [{ connection: "loading" }, "Loading your matters…"],
      [{ data: undefined }, "Loading your matters…"],
      [{ connection: "unavailable" }, "Your matters could not be loaded."],
      [{ workspace: null }, "No office folder is open."],
      [{}, "The office folder has no matters yet."],
      [{ error: new Error("workspace ws-1 unreachable") }, "Your matters could not be loaded."],
      [{ data: { ...empty, problems: [{ path: "AK", message: "Přístup odepřen" }] } }, "Your matters could not be loaded."],
    ];
    for (const [props, expected] of cases) {
      const out = lite(props);
      expect(out).toContain(expected);
      expect(out).not.toContain("dashboard");
      expect(out).not.toMatch(BANNED);
    }
    expect(lite({ workspace: null })).toContain("Open the office folder");
    expect(lite({})).toContain("New matter");
  });
  test("pro stav zůstává beze změny", () => {
    const out = html(<OkfPageState {...base} workspace={null}>{() => "dashboard"}</OkfPageState>);
    expect(out).toContain("No workspace is open.");
    expect(out).toContain("Open a workspace");
  });
});
