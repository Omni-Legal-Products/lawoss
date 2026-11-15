import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { TodayView } from "../src/lawoss/lite/pages/today-page";
import { continueCard, dayTone, hotRows, nearestTile, todayLead, waitingCounts, weekCounts, type CaseDate, type TodayDeadline, type TodayMatter, type TodayModel, type TodayTask } from "../src/lawoss/lite/today-model";
import { clearHomePrefill, peekHomePrefill, requestHomePrefill } from "../src/lawoss/lite/home-prefill";
import { registersSummary } from "../src/lawoss/lite/sidebar-model";
import type { McpStatus, McpStatusMap } from "@/app/types";

// Spec Dnes pre alfu 14 (output/2026-11-14-overenie-alfa12/spec-dnes.md): Dnes ako pasívny prehľad spisu.
// Dlaždice, „Čo horí“, „Čaká na vás“, „Pokračovať“ a pole chatu; odvodenia sú čisté funkcie v today-model.ts.

const TODAY = "2026-11-14";
const MATTER = { path: "Klienti/Tatran/Spisy/M001", title: "Úhrada dodávok" };
const deadline = (date: string, daysLeft: number, extra: Partial<TodayDeadline> = {}): TodayDeadline => ({
  date, title: `Lehota ${date}`, recordId: `D-${date}`, matter: MATTER, tier: daysLeft < 0 ? "overdue" : daysLeft <= 1 ? "today" : daysLeft <= 7 ? "soon" : "later", daysLeft, ...extra,
});
const invalidDeadline = (): TodayDeadline => ({ date: "31. 2. 2026", raw: "31. 2. 2026", title: "Zlá lehota", recordId: "D-X", matter: MATTER, invalid: true, tier: "today", daysLeft: 0 });
const work = (key: string, due: string, daysLeft: number, extra: Partial<CaseDate> = {}): CaseDate => ({ key, id: key, title: `Úloha ${key}`, due, daysLeft, matters: [MATTER], ...extra });
const html = (node: ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
const now = new Date(`${TODAY}T09:00:00`);

describe("dlaždice", () => {
  test("farba dní: po termíne, neplatný a do 3 dní červená, do 7 jantárová, inak neutrálna", () => {
    expect([null, -2, 0, 3, 4, 7, 8].map(dayTone)).toEqual(["red", "red", "red", "red", "amber", "amber", "neutral"]);
  });

  test("dlaždica s pracovným termínom sa volá „Najbližší termín“ (nie lehota), štítok ostáva", () => {
    const tile = (model: TodayModel) => html(<TodayView model={model} locale="sk" now={now} />).match(/data-lawoss-tile="nearest".*?<\/a>/)?.[0] ?? "";
    const work = tile({ deadlines: [], tasks: [{ key: "t", id: "T", title: "Pojednávanie", due: "2026-11-17", matters: [MATTER] }], inputs: [], recent: [] });
    expect(work).toContain('data-kind="work"');
    expect(work).toContain(">Najbližší termín<");
    expect(work).toContain(">pracovný termín<");
    expect(work).not.toContain("Najbližšia lehota");
    const due = tile({ deadlines: [deadline("2026-11-17", 3)], tasks: [], inputs: [], recent: [] });
    expect(due).toContain(">Najbližšia lehota<");
  });

  test("Najbližšia lehota: deadlines[0]; neplatný dátum podľa `invalid`, nie umelého daysLeft 0; bez lehoty termín z prípadu", () => {
    expect(nearestTile([deadline("2026-11-17", 3)], [])).toMatchObject({ kind: "deadline", state: "due" });
    expect(nearestTile([deadline("2026-11-10", -4)], [])).toMatchObject({ kind: "deadline", state: "overdue" });
    expect(nearestTile([invalidDeadline(), deadline("2026-11-17", 3)], [])).toMatchObject({ kind: "deadline", state: "invalid" });
    // Úloha aplikácie nie je termín z prípadu; uplynulý termín má prednosť (ako v úvode).
    const dates = [work("A", "2026-11-15", 1, { app: {} }), work("P", "2026-11-12", -2), work("B", "2026-11-16", 2)];
    expect(nearestTile([], dates)).toMatchObject({ kind: "work", state: "passed", item: { key: "P" } });
    expect(nearestTile([], dates.slice(2))).toMatchObject({ kind: "work", state: "due", item: { key: "B" } });
    expect(nearestTile([], [dates[0]!])).toEqual({ kind: "none" });
  });

  test("Tento týždeň: lehoty mimo pokoja (aj po termíne a neplatné) a termíny 0–7 dní", () => {
    const deadlines = [invalidDeadline(), deadline("2026-11-10", -4), deadline("2026-11-20", 6), deadline("2026-11-25", 11)];
    const dates = [work("P", "2026-11-12", -2), work("A", "2026-11-14", 0), work("B", "2026-11-21", 7), work("C", "2026-11-22", 8)];
    expect(weekCounts(deadlines, dates, TODAY)).toEqual({ deadlines: 3, dates: 2 });
  });

  test("Čaká na vás: každá položka raz (po termíne má prednosť pred „podľa pokynu“), súčet = rozpis", () => {
    const deadlines = [invalidDeadline(), deadline("2026-11-10", -4, { basis: "instruction" }), deadline("2026-11-18", 4, { basis: "instruction" }), deadline("2026-11-19", 5)];
    const unreadable: TodayTask[] = [{ key: "u", id: "U", title: "Zlý dátum", due: "31. 2.", matters: [MATTER] }];
    const waiting = waitingCounts({ inputs: 3, deadlines, dates: [work("P", "2026-11-12", -2)], unreadable, events: [{ kind: "candidate" }, { kind: "deadline" }, { kind: "work" }] });
    expect(waiting).toEqual({ filing: 3, overdue: 2, verify: 3, confirm: 1, total: 9 });
    expect(waiting.filing + waiting.overdue + waiting.verify + waiting.confirm).toBe(waiting.total);
    expect(waitingCounts({ inputs: 0, deadlines: [], dates: [], unreadable: [] }).total).toBe(0);
  });
});

describe("Čo horí", () => {
  test("najviac 5 riadkov; neplatné navrchu; po termíne, dnes a zajtra a evidované lehoty pred starými termínmi (#276)", () => {
    const old = Array.from({ length: 6 }, (_, i) => work(`old${i}`, `2026-08-1${i}`, -90 + i));
    const deadlines = [invalidDeadline(), deadline("2026-11-10", -4), deadline("2026-11-26", 12)];
    const dates = [...old, work("yesterday", "2026-11-13", -1), work("tomorrow", "2026-11-15", 1)];
    const { rows, more } = hotRows(deadlines, dates, [], 5);
    expect(rows.map((r) => r.kind === "deadline" ? r.item.recordId : r.item.key)).toEqual(["D-X", "D-2026-11-10", "yesterday", "tomorrow", "D-2026-11-26"]);
    expect(more).toBe(6);
    expect(rows.map((r) => r.tone)).toEqual(["red", "red", "red", "red", "neutral"]);
  });

  test("štítok pôvodu: podľa pokynu, pracovný termín (aj úloha aplikácie), inak evidovaná; nikdy „z listiny“", () => {
    const { rows } = hotRows([deadline("2026-11-16", 2, { basis: "instruction" }), deadline("2026-11-17", 3)], [work("A", "2026-11-16", 2)], [{ key: "u", id: "U", title: "Zlý", due: "x", matters: [MATTER] }], 5);
    expect(rows.map((r) => [r.kind, r.origin, r.daysLeft])).toEqual([["unreadable", "work", null], ["deadline", "instruction", 2], ["work", "work", 2], ["deadline", "recorded", 3]]);
    const out = html(<TodayView model={{ deadlines: [deadline("2026-11-16", 2, { basis: "instruction" }), deadline("2026-11-17", 3)], tasks: [], inputs: [], recent: [] }} locale="sk" now={now} />);
    expect(out).toContain('<span class="lw-dnes-pill" data-tone="amber">podľa pokynu · overiť</span>');
    expect(out).toContain('<span class="lw-dnes-pill" data-tone="neutral">evidovaná</span>');
    expect(out).not.toContain("z listiny");
  });
});

describe("úvod a karty", () => {
  test("jedna veta: naliehavá lehota → termín do 7 dní → neúplné čítanie → vzdialená lehota → termín → stav", () => {
    const far = deadline("2026-11-25", 11);
    const soon = work("S", "2026-11-15", 1);
    expect(todayLead([deadline("2026-11-16", 2)], [soon])).toMatchObject({ kind: "deadline" });
    expect(todayLead([far], [soon])).toMatchObject({ kind: "date", item: { key: "S" } });
    expect(todayLead([far], [], { complete: false, recorded: 1 })).toEqual({ kind: "partial" });
    expect(todayLead([far], [])).toMatchObject({ kind: "deadline" });
    expect(todayLead([], [work("A", "2026-11-15", 1, { app: {} })], { complete: true, recorded: 0 })).toEqual({ kind: "unrecorded" });
    expect(todayLead([], [], { complete: true, recorded: 2 })).toEqual({ kind: "quiet" });
  });

  test("karta Pokračovať: lehota, inak pracovný termín (nikdy zmeškaná lehota), stav prípadu, udalosť alebo počet úloh", () => {
    const base: TodayMatter = { ...MATTER, client: "Tatran", deadlines: [], openTasks: [], counts: { records: 1, evidence: 0, subjects: 0 } };
    expect(continueCard({ ...base, deadlines: [{ date: "2026-11-17", title: "L", recordId: "L" }], lastEvent: { date: "2026-11-01", text: "Doručená žaloba" } }, TODAY))
      .toEqual({ path: MATTER.path, title: MATTER.title, client: "Tatran", next: { kind: "deadline", date: "2026-11-17", daysLeft: 3, tone: "red" }, line: { kind: "event", text: "Doručená žaloba" } });
    const missed = continueCard({ ...base, state: "aktívny", deadlines: [{ date: "2026-11-01", title: "L", recordId: "L" }], openTasks: [{ id: "T", title: "T", due: "2026-11-20" }, { id: "T2", title: "T2" }] }, TODAY);
    expect(missed.next).toEqual({ kind: "work", date: "2026-11-20", daysLeft: 6, tone: "neutral" });
    expect(missed.state).toBe("aktívny");
    expect(missed.line).toEqual({ kind: "tasks", count: 2 });
    expect(continueCard(base, TODAY)).toMatchObject({ next: null, line: null });
    // Platnosť záznamu (OKF `status: active`) nie je stav prípadu.
    expect(continueCard({ ...base, state: "active" }, TODAY).state).toBeUndefined();
  });
});

describe("obrazovka", () => {
  const model: TodayModel = { deadlines: [deadline("2026-11-17", 3)], tasks: [], inputs: [], recent: [] };
  const statuses = (status: McpStatus): McpStatusMap => ({ slovlex: status, orsr: status });

  test("načítanie: kostra namiesto čísla 0 v dlaždiciach aj v „po termíne“", () => {
    const out = html(<TodayView model={model} locale="sk" now={now} pending />);
    expect(out.match(/data-lawoss-skeleton=""/g)).toHaveLength(3);
    expect(out).not.toMatch(/data-lawoss-tile="week".*?<span class="lw-dnes-num">0/);
  });

  test("Registre: rovnaký stav a cieľ ako pätka bočného panela; neznámy stav dlaždicu neukáže", () => {
    const ready = html(<TodayView model={model} locale="sk" now={now} registers={registersSummary(statuses({ status: "connected" }))} activeId="ws1" />);
    expect(ready).toMatch(/<a class="lw-dnes-tile" data-lawoss-tile="registers" data-state="ready" href="\/workspace\/ws1\/settings\/extensions\/mcp"/);
    expect(ready).toContain("2<small>/2</small>");
    expect(ready).toContain("pripravené");
    const failing = html(<TodayView model={model} locale="sk" now={now} registers={registersSummary(statuses({ status: "failed", error: "x" }))} />);
    expect(failing).toContain('data-state="failing"');
    expect(failing).toContain("nefungujú");
    expect(html(<TodayView model={model} locale="sk" now={now} registers={registersSummary(null)} />)).not.toContain('data-lawoss-tile="registers"');
  });

  test("Čaká na vás: zlatá len keď niečo čaká; inak „nič nečaká“ len pri úplnom čítaní", () => {
    const waiting = html(<TodayView model={{ ...model, deadlines: [deadline("2026-11-10", -4)] }} locale="sk" now={now} evidence={{ complete: true, recorded: 1, unrecorded: 0 }} />);
    expect(waiting).toMatch(/data-lawoss-tile="waiting" data-gold="true"/);
    expect(waiting).toContain("1 po termíne");
    const none = html(<TodayView model={model} locale="sk" now={now} evidence={{ complete: true, recorded: 1, unrecorded: 0 }} />);
    expect(none).not.toContain("data-gold");
    expect(none).toContain("nič nečaká");
  });

  test("bez návrhu asistenta, bez krokov „3 z 5“ a bez „Začnite tu“; bez „+ Nový prípad“ (#428)", () => {
    const out = html(<TodayView model={model} locale="sk" now={now} />);
    expect(out).not.toContain("návrh asistenta");
    expect(out).not.toContain("Otvoriť v chate");
    expect(out).not.toContain("kroky");
    expect(out).not.toContain("Začnite tu");
    expect(out).not.toContain("lw-dnes-secondary");
    expect(out).not.toContain("/welcome?continue=matter");
    expect(out).not.toContain("lw-today-primary");
  });

  test("pozdrav v jednom riadku: celé znenie v title, meno samostatne na skrátenie", () => {
    const out = html(<TodayView model={model} locale="sk" now={now} name="Mgr. Testovací Advokát" />);
    const h1 = out.match(/<h1 class="lw-today-greeting"[^>]*>[\s\S]*?<\/h1>/)?.[0] ?? "";
    expect(h1).toMatch(/title="[^"]+, Mgr\. Testovací Advokát"/);
    expect(h1).toContain('<span class="lw-today-name">, Mgr. Testovací Advokát</span>');
    expect(html(<TodayView model={model} locale="sk" now={now} />)).not.toContain("lw-today-name");
    const css = readFileSync(join(import.meta.dir, "../src/lawoss/lite/pages/today.css"), "utf8");
    expect(css).toMatch(/\.lw-dnes \.lw-today-greeting \{[^}]*white-space: nowrap;/);
    expect(css).toMatch(/\.lw-dnes \.lw-today-greeting > \.lw-today-name \{[^}]*text-overflow: ellipsis;/);
    expect(css).toContain('grid-template-areas: "date date" "title actions" "lead lead";');
  });

  test("pole chatu v doku pri spodnom okraji: nepriehľadné pozadie stránky, bez okraja posuvnej plochy pod ním", () => {
    const out = html(<TodayView model={model} locale="sk" now={now} />);
    expect(out).toMatch(/<div class="lw-dnes-dock"><section class="lw-dnes-chat"[^>]*data-lawoss-chatbar=""/);
    const css = readFileSync(join(import.meta.dir, "../src/lawoss/lite/pages/today.css"), "utf8");
    const dock = /\.lw-dnes-dock \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(dock).toContain("position: sticky; bottom: 0;");
    expect(dock).toContain("background: var(--lw-surface);");
    expect(css).toContain(".lw-experiment-content > .lw-sheet:has(.lw-dnes) { padding-bottom: 0; }");
    // Pole samé už nie je sticky ani priesvitné.
    const bar = /\.lw-dnes-chat \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(bar).not.toContain("sticky");
    expect(bar).not.toContain("94%");
  });

  test("pole chatu: tri návrhy (zaradenie len pri dokumentoch), nič neodosiela ani nedáva vetu do adresy", () => {
    const out = html(<TodayView model={model} locale="sk" now={now} />);
    const bar = out.slice(out.indexOf("data-lawoss-chatbar"));
    expect([...bar.matchAll(/class="lw-dnes-suggest">([^<]*)</g)].map((m) => m[1])).toEqual(["Čo mám dnes urobiť?", "Skontroluj lehoty tohto týždňa"]);
    expect(bar).not.toContain("action=");
    expect(bar).not.toContain("href=");
    const filing = html(<TodayView model={{ ...model, inputs: [{ id: "IN-1", received: "2026-11-10", source: "mail", original: "a.pdf", matterPath: MATTER.path, file: "x" }] }} locale="sk" now={now} />);
    expect(filing).toContain(">Zaraď nové dokumenty<");
  });
});

describe("predvyplnenie Domova", () => {
  afterEach(() => clearHomePrefill());
  test("veta vydrží opakované čítanie (StrictMode), zmizne po vyčistení a po 10 s", () => {
    requestHomePrefill("  Čo mám dnes urobiť?  ", 1_000);
    expect(peekHomePrefill(2_000)).toBe("Čo mám dnes urobiť?");
    expect(peekHomePrefill(2_000)).toBe("Čo mám dnes urobiť?");
    clearHomePrefill();
    expect(peekHomePrefill(2_000)).toBe("");
    requestHomePrefill("stará", 1_000);
    expect(peekHomePrefill(12_000)).toBe("");
    requestHomePrefill("   ");
    expect(peekHomePrefill()).toBe("");
  });
});
