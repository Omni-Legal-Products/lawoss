import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { TodayView } from "../src/lawoss/lite/pages/today-page";
import { ClientsView } from "../src/lawoss/lite/pages/clients-page";
import { LiteMatterView } from "../src/lawoss/lite/pages/matter-page";
import { liteMatterLink } from "../src/lawoss/lite/links";
import type { TodayModel } from "../src/lawoss/lite/today-model";
import type { Cockpit } from "../../../lawoss/okf/cockpit";

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
    expect(out).toContain("The conversation could not be opened: boom");
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
