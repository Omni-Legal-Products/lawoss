import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { t } from "../src/i18n";
import { RealOverview } from "../src/lawoss/domains/prehlad/prehlad-page";
import { MatterCockpit } from "../src/lawoss/domains/spis/spis-page";
import { groupEvents, matterCards, monthDays, practiceAlerts, weekDays } from "../src/lawoss/domains/overview-model";
import { eventKindText, riskText } from "../src/lawoss/domains/overview-views";
import type { MatterTextKey } from "../src/lawoss/i18n/matters";
import { today, type OkfReadResult } from "../src/lawoss/okf/read-model";
import { buildOverview, type MatterInput } from "../../../lawoss/okf/read";
import { buildCockpit } from "../../../lawoss/okf/cockpit";
import type { OkfRecord } from "../../../lawoss/okf-pamat/src/record";

// Syntetická kancelária (fiktívne mená a značky). „Dnes“ je skutočný dnešok, dátumy sú relatívne k nemu.
const TODAY = today();
const day = (offset: number): string => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const base = { okf: 1, description: "", layer: "L2", jurisdiction: "sk", status: "active", created: day(-30), updated: day(-4), truth: "Syntetické.", timeline: [] } as const;
const rec = (fields: Partial<OkfRecord> & Pick<OkfRecord, "id" | "type" | "title">): OkfRecord => ({ ...base, ...fields } as OkfRecord);
const dl = `${day(14)} Lehota na odvolanie`;
const novak: MatterInput = {
  path: "Klienti/Novak/Spisy/A", clientTitle: "Novák s. r. o.", scopePaths: ["Klienti/Novak/Spisy/A", "Klienti/Novak"],
  cardFrontmatter: { title: "Novák proti Stavby Juh", spisova_znacka: "12Cb/48/2026", sud: "Okresný súd s veľmi dlhým názvom pre test pretekania" },
  records: [
    rec({ id: "M-001", type: "matter", title: "Novák proti Stavby Juh", timeline: [{ date: day(-5), text: "Fikcia doručenia rozsudku (NS SR 1VCdo/8/2025).", kind: "delivery" }, { date: day(-60), text: "Podaná žaloba.", kind: "filing" }] }),
    rec({ id: "D-001", type: "decision", title: "Rozsudok", deadlines: [dl], sources: [{ id: "r", title: "Rozsudok.pdf", resource: "01_Podklady/Rozsudok.pdf" }],
      verified: [{ type: "human", by: "JUDr. Testovacia", at: `${day(-4)}T09:00:00Z`, deadline: dl, truth: "Syntetické." }],
      timeline: [{ date: day(-5), text: "Fikcia doručenia.", kind: "delivery" }, { date: day(-4), text: "Lehota overená.", kind: undefined }] }),
    rec({ id: "S-001", type: "subject", title: "Stavby Juh, a. s.", timeline: [{ date: day(-4), text: "Subjekt zapísaný." }] }),
    rec({ id: "S-002", type: "subject", title: "Novák s. r. o.", timeline: [{ date: day(-4), text: "Subjekt zapísaný." }] }),
    rec({ id: "SC-001", type: "screening", title: "Preverenie", subject_ref: "S-001", risk: "medium", conclusion: "enhanced_diligence", registries: ["Finančná správa: daňový nedoplatok"] }),
    rec({ id: "T-001", type: "task", title: "Pripraviť odvolanie", state: "in_progress", due: day(7), assignee: "MU" }),
  ],
};
const horak: MatterInput = {
  path: "Klienti/Horak/Spisy/B", clientTitle: "Horák & syn", scopePaths: ["Klienti/Horak/Spisy/B", "Klienti/Horak"],
  cardFrontmatter: { title: "Horák – žaloba" },
  records: [
    rec({ id: "D-001", type: "decision", title: "Výzva", deadlines: [`${TODAY} Vyjadrenie k žalobe`], sources: [{ id: "v", title: "Výzva.pdf" }] }),
    rec({ id: "T-001", type: "task", title: "Dokončiť vyjadrenie", state: "pending", due: day(-3) }),
  ],
};
function fixture(): OkfReadResult {
  const inputs = [novak, horak].map((input) => structuredClone(input));
  return { ...buildOverview(inputs, TODAY), inputs, problems: [], truncated: false };
}
const sk = (key: MatterTextKey, params?: Record<string, string | number>) => t(`lawoss.matters.${key}`, "sk", params);

describe("overview model", () => {
  test("calendar weeks start on Monday and mark weekends without any holiday table", () => {
    const days = weekDays(TODAY, 3);
    expect(days).toHaveLength(21);
    expect(new Date(`${days[0]!.iso}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(days.filter((d) => d.weekend).map((d) => new Date(`${d.iso}T00:00:00Z`).getUTCDay()).sort()).toEqual([0, 0, 0, 6, 6, 6]);
    expect(days.filter((d) => d.today).map((d) => d.iso)).toEqual([TODAY]);
    const month = monthDays("2026-12-28", TODAY);
    expect(month.length % 7).toBe(0);
    expect(month.filter((d) => !d.outside)).toHaveLength(31);
  });

  test("history groups the same day and kind and identical texts, keeping every distinct text and record", () => {
    const cockpit = buildCockpit(fixture(), novak.path, TODAY);
    const groups = groupEvents(cockpit?.events ?? []);
    const delivery = groups.find((g) => g.kind === "delivery");
    expect(delivery?.recordIds).toEqual(["M-001", "D-001"]);
    expect(delivery?.texts).toEqual(["Fikcia doručenia rozsudku (NS SR 1VCdo/8/2025).", "Fikcia doručenia."]);
    const subjects = groups.find((g) => g.texts[0] === "Subjekt zapísaný.");
    expect(subjects?.recordIds).toEqual(["S-001", "S-002"]);
    // Rôzne udalosti bez druhu v ten istý deň ostávajú samostatné.
    expect(groups.find((g) => g.texts.includes("Lehota overená."))?.texts).toEqual(["Lehota overená."]);
  });

  test("practice alerts come only from data: deadline due, overdue task, risky screening", () => {
    const alerts = practiceAlerts(fixture(), TODAY);
    expect(alerts.map((a) => a.kind)).toEqual(["deadline", "task", "screening"]);
    expect(alerts.map((a) => ("client" in a ? a.client : undefined))).toEqual(["Horák & syn", "Horák & syn", "Novák s. r. o."]);
  });

  test("cards sort by the nearest deadline and carry its confirmation", () => {
    const cards = matterCards(fixture(), TODAY);
    expect(cards.map((c) => [c.client, c.nearest?.date, Boolean(c.nearest?.confirmed), c.overdueTasks])).toEqual([
      ["Horák & syn", TODAY, false, 1],
      ["Novák s. r. o.", day(14), true, 0],
    ]);
    expect(cards[1]?.screening?.risk).toBe("medium");
  });

  test("canonical event kinds and risk values are localized; unknown values stay verbatim", () => {
    expect(eventKindText("delivery", sk)).toBe("doručenie");
    expect(eventKindText("email", sk)).toBe("e-mail");
    expect(eventKindText("filing", sk)).toBe("podanie");
    expect(eventKindText("vlastný druh", sk)).toBe("vlastný druh");
    expect(riskText("medium", sk)).toBe("stredné");
  });
});

describe("overview and case views", () => {
  test("practice overview shows one confirmation wording per deadline and the screening alert", () => {
    const html = renderToStaticMarkup(<MemoryRouter><RealOverview data={fixture()} /></MemoryRouter>);
    expect(html).toContain('data-lawoss-alert="deadline"');
    expect(html).toContain('data-lawoss-alert="task"');
    expect(html).toContain('data-lawoss-alert="screening"');
    expect(html).toContain("Finančná správa: daňový nedoplatok");
    expect(html).toContain("risk medium");
    expect(html).toContain("confirmed by a person");
    expect(html).toContain("recorded, not verified");
    expect(html).not.toContain(">recorded<");
    expect(html).toContain('data-lawoss-matter-card="Klienti/Novak/Spisy/A"');
    expect(html).toContain('data-weekend="true"');
    expect(html).not.toContain("lawoss.matters.");
  });

  test("case view: breadcrumb instead of a path, verifier, grouped history and localized kinds", () => {
    const data = fixture();
    const cockpit = buildCockpit(data, novak.path, TODAY);
    if (!cockpit) throw new Error("cockpit missing");
    const html = renderToStaticMarkup(<MatterCockpit cockpit={cockpit} now={TODAY} raw={{}} client="Novák s. r. o." />);
    expect(html).toContain('data-lawoss-crumb=""');
    expect(html).toContain("Novák s. r. o.");
    expect(html).toContain("confirmed by JUDr. Testovacia");
    expect(html).toContain('data-lawoss-screening="SC-001"');
    expect(html).toContain("2 records");
    expect(html).toContain(">delivery<");
    expect(html).toContain('data-lawoss-deadline-hero="later"');
    expect(html).not.toContain("lawoss.matters.");
    // Plná cesta k priečinku je len v zdroji dole, nie nad názvom.
    expect(html.indexOf(novak.path)).toBeGreaterThan(html.indexOf("<h1"));
  });

  test("an empty attention panel says what is fine and what comes next", () => {
    const data = fixture();
    data.inputs[0]!.records = data.inputs[0]!.records.filter((r) => r.id !== "SC-001");
    const cockpit = buildCockpit({ ...buildOverview(data.inputs, TODAY), inputs: data.inputs, problems: [] }, novak.path, TODAY);
    if (!cockpit) throw new Error("cockpit missing");
    const html = renderToStaticMarkup(<MatterCockpit cockpit={cockpit} now={TODAY} raw={{}} />);
    expect(html).toContain('data-lawoss-attention-clear=""');
    expect(html).toContain("Nothing urgent");
    expect(html).toContain("Up next");
  });
});

describe("honest states", () => {
  test("an invalid deadline date and task due become a visible alert and card state, never silently dropped", () => {
    const data = fixture();
    data.inputs[1]!.records.push(rec({ id: "D-002", type: "decision", title: "Uznesenie", deadlines: ["do pätnástich dní"], sources: [{ id: "u", title: "Uznesenie.pdf" }] }));
    const overview = { ...buildOverview(data.inputs, TODAY), inputs: data.inputs, problems: [], truncated: false };
    const alerts = practiceAlerts(overview, TODAY);
    expect(alerts.filter((a) => a.kind === "invalidDate").map((a) => a.kind === "invalidDate" ? a.raw : "")).toEqual(["do pätnástich dní"]);
    const noDeadline = { ...horak, path: "Klienti/Horak/Spisy/C", records: [rec({ id: "T-009", type: "task", title: "Zistiť termín", state: "pending", due: "budúci týždeň" })] };
    const inputs = [structuredClone(noDeadline)];
    const cards = matterCards({ ...buildOverview(inputs, TODAY), inputs }, TODAY);
    expect(cards[0]?.invalid).toBe("budúci týždeň");
    const html = renderToStaticMarkup(<MemoryRouter><RealOverview data={{ ...buildOverview(inputs, TODAY), inputs, problems: [], truncated: false }} /></MemoryRouter>);
    expect(html).toContain('data-lawoss-alert="invalid"');
    expect(html).toContain('data-lawoss-card-invalid=""');
  });

  test("a truncated or partial read never shows the green all-clear", () => {
    const quiet: MatterInput = { path: "Klienti/Q/Spisy/Q", clientTitle: "Q", scopePaths: ["Klienti/Q/Spisy/Q", "Klienti/Q"], records: [rec({ id: "M-001", type: "matter", title: "Pokojný prípad" })] };
    const inputs = [quiet];
    const full = renderToStaticMarkup(<MemoryRouter><RealOverview data={{ ...buildOverview(inputs, TODAY), inputs, problems: [], truncated: false }} /></MemoryRouter>);
    expect(full).toContain('data-lawoss-practice-clear=""');
    const truncated = renderToStaticMarkup(<MemoryRouter><RealOverview data={{ ...buildOverview(inputs, TODAY), inputs, problems: [], truncated: true }} /></MemoryRouter>);
    expect(truncated).not.toContain('data-lawoss-practice-clear=""');
    expect(truncated).toContain('data-lawoss-practice-partial=""');
    const partial = renderToStaticMarkup(<MemoryRouter><RealOverview data={{ ...buildOverview(inputs, TODAY), inputs, problems: [{ path: "Klienti/Q/Spisy/Q/memory/X.md", message: "zlý záznam" }], truncated: false }} /></MemoryRouter>);
    expect(partial).not.toContain('data-lawoss-practice-clear=""');
  });

  test("a verification made before the record changed confirms nothing, in the hero and in the attention row alike", () => {
    const data = fixture();
    const decision = data.inputs[0]!.records.find((r) => r.id === "D-001")!;
    decision.deadlines = [`${day(3)} Lehota na odvolanie`];
    decision.verified = [{ type: "human", by: "JUDr. Testovacia", at: `${day(-10)}T09:00:00Z`, deadline: `${day(3)} Lehota na odvolanie`, truth: "Syntetické." }];
    const overview = { ...buildOverview(data.inputs, TODAY), inputs: data.inputs, problems: [], truncated: false };
    expect(overview.upcomingDeadlines.find((d) => d.recordId === "D-001" && d.matter.path === novak.path)?.confirmed).toBeUndefined();
    const cockpit = buildCockpit(overview, novak.path, TODAY);
    if (!cockpit) throw new Error("cockpit missing");
    const html = renderToStaticMarkup(<MatterCockpit cockpit={cockpit} now={TODAY} raw={{}} />);
    const row = html.slice(html.indexOf('data-lawoss-attention-row="lehota:D-001'), html.indexOf("</div>", html.indexOf('data-lawoss-attention-row="lehota:D-001')));
    expect(row).toContain("recorded, not verified");
    expect(row).not.toContain("verified by a person");
    expect(html).not.toContain("confirmed by JUDr. Testovacia");
  });

  test("a client-level deadline shared by two cases is one alert and one calendar chip", () => {
    const shared = rec({ id: "D-050", type: "decision", title: "Klientska lehota", deadlines: [`${TODAY} Spoločná lehota`], sources: [{ id: "k", title: "Klient.pdf" }] });
    const make = (name: string): MatterInput => ({ path: `Klienti/K/Spisy/${name}`, clientTitle: "K", scopePaths: [`Klienti/K/Spisy/${name}`, "Klienti/K"],
      records: [structuredClone(shared)], recordFiles: { "D-050": "Klienti/K/memory/D-050.md" } });
    const inputs = [make("A"), make("B")];
    const overview = { ...buildOverview(inputs, TODAY), inputs, problems: [], truncated: false };
    expect(practiceAlerts(overview, TODAY).filter((a) => a.kind === "deadline")).toHaveLength(1);
    const html = renderToStaticMarkup(<MemoryRouter><RealOverview data={overview} /></MemoryRouter>);
    expect(html.split('data-kind="deadline"').length - 1).toBe(1);
  });
});
