import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { LAYER_OF } from "../../../lawoss/okf-pamat/src/schema.ts";
import type { OkfRecord } from "../../../lawoss/okf-pamat/src/record.ts";
import { buildOverview, type MatterInput, type MatterOverview, type UpcomingDeadline } from "../../../lawoss/okf/read";
import { shellCs, shellDe, shellEn, shellSk } from "../src/lawoss/i18n/shell";
import { CARDS_SHOWN, caseCards, cardPill, clientDeadlineRows, clientInitials, inputCounts, kindBreakdown, openTaskTotal, phaseMissing, recentChats, recentChatsKey, termTile } from "../src/lawoss/lite/client-cards";
import { ClientDashboardView } from "../src/lawoss/lite/client-dashboard";
import { clientDeadlinesLink, liteMatterLink } from "../src/lawoss/lite/links";
import { buildToday, caseDates, invalidCaseDates, waitingCounts } from "../src/lawoss/lite/today-model";
import { homeRoute } from "@/react-app/shell/workspace-routes";

// Spec Klient › Prehľad pre alfu 14 (output/2026-11-14-overenie-alfa12/spec-klient.md): bežný režim ako pasívny
// prehľad spisu. Odvodenia sú čisté funkcie v client-cards.ts; poctivé stavy (#242, #264, čiastočné čítanie,
// nenačítané vstupy) ostávajú viditeľné ako tiché riadky.

const TODAY = "2026-11-14";
const UHRADA = "Klienti/Tatran/Spisy/M001-uhrada";
const VADY = "Klienti/Tatran/Spisy/M002-vady";
const record = (id: string, type: string, title: string, extra: Partial<OkfRecord> = {}): OkfRecord => ({
  okf: 1, id, type, title, description: "syntetický záznam", layer: LAYER_OF.task, jurisdiction: "sk", status: "active",
  created: "2026-09-06", updated: "2026-11-10", truth: "", timeline: [], ...extra,
});
const inputs: MatterInput[] = [
  { path: UHRADA, cardFrontmatter: { title: "Úhrada dodávok", spisova_znacka: "12Cb/45/2026", sud: "MS Košice" },
    intake: "| ID | Prijaté | Zdroj | Originál | Stav | Záznamy |\n|---|---|---|---|---|---|\n| IN-001 | 2026-10-01 | mail | [a.pdf](./01_Podklady/IN-001/a.pdf) | processed | M001-E1 |\n| IN-002 | 2026-11-10 | mail | [b.pdf](./01_Podklady/IN-002/b.pdf) | pending | |\n| IN-003 | 2026-11-11 | mail | [c.pdf](./00_Na_zatriedenie/c.pdf) | pending | |",
    records: [
      record("M001-L1", "matter", "Úhrada dodávok", { deadlines: ["2026-11-17 Vyjadrenie k žalobe"] }),
      record("M001-T1", "task", "Doplniť prílohu", { state: "pending", due: "2026-11-18" }),
    ] },
  { path: VADY, cardFrontmatter: { title: "Vady rekonštrukcie" }, records: [record("M002-T1", "task", "Fotodokumentácia", { state: "pending", due: "2026-11-10" })] },
];
const data = { ...buildOverview(inputs, TODAY), inputs };
const html = (node: ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
const matter = (path: string, extra: Partial<MatterOverview> = {}): MatterOverview => ({ path, title: path.split("/").pop() ?? path, deadlines: [], openTasks: [], counts: { records: 1, evidence: 0, subjects: 0 }, ...extra });
const deadline = (date: string, extra: Partial<UpcomingDeadline> = {}): UpcomingDeadline => ({ date, title: `Lehota ${date}`, recordId: `D-${date}`, matter: { path: UHRADA, title: "Úhrada dodávok" }, ...extra });
const view = (extra: Partial<Parameters<typeof ClientDashboardView>[0]> = {}) => html(<ClientDashboardView workspaceId="tatran" locale="sk" todayIso={TODAY}
  matters={data.matters} deadlines={[...data.overdue, ...data.upcomingDeadlines]} today={buildToday(data, TODAY)} {...extra} />);
const source = (path: string) => readFileSync(join(import.meta.dir, "../src", path), "utf8");

describe("model dlaždíc", () => {
  test("Najbližšia lehota: ten istý termín ako doteraz (clientTerm), počet dní a farba; bez termínu nič", () => {
    expect(termTile(data.matters, TODAY)).toMatchObject({ kind: "deadline", title: "Vyjadrenie k žalobe", daysLeft: 3, late: false, tone: "red", matter: { path: UHRADA } });
    const late = [matter("A", { deadlines: [{ date: "2026-11-10", title: "Zmeškaná", recordId: "L" }] })];
    expect(termTile(late, TODAY)).toMatchObject({ kind: "deadline", late: true, tone: "red", daysLeft: -4 });
    // Pracovný termín nie je lehota: bez farby naliehavosti, kým nie je po termíne.
    const work = [matter("B", { openTasks: [{ id: "T", title: "Pojednávanie", due: "2026-11-15" }] })];
    expect(termTile(work, TODAY)).toMatchObject({ kind: "work", daysLeft: 1, tone: "neutral" });
    expect(termTile([matter("C")], TODAY)).toEqual({ kind: "none" });
  });

  test("rozpis prípadov len z druhov v dátach; prípad s dvoma druhmi pri oboch, bez druhu nič", () => {
    const kinds = { a: "Konanie", b: "Konanie · Duševné vlastníctvo", c: "Korporátna agenda", d: "" };
    expect(kindBreakdown(kinds, ["a", "b", "c", "d", "e"])).toEqual([
      { label: "Konanie", count: 2 }, { label: "Duševné vlastníctvo", count: 1 }, { label: "Korporátna agenda", count: 1 },
    ]);
    expect(kindBreakdown({}, ["a"])).toEqual([]);
  });

  test("Čaká na vás: každá položka raz a „na zaradenie“ sa rovná nezaradeným vstupom klienta", () => {
    const model = buildToday(data, TODAY);
    const dates = caseDates(model.tasks, TODAY, 14, model.deadlines);
    const waiting = waitingCounts({ inputs: model.inputs.length, deadlines: model.deadlines, dates, unreadable: invalidCaseDates(model.tasks) });
    expect(waiting).toMatchObject({ filing: 1, overdue: 1, verify: 0, total: 2 });
    expect(waiting.filing).toBe(inputCounts(data.inputs, data.matters.map((m) => m.path))?.unfiled ?? -1);
    const out = view({ inputs: inputCounts(data.inputs, data.matters.map((m) => m.path)) });
    expect(out).toMatch(/data-lawoss-tile="waiting" data-gold="true">.*?<span class="lw-dnes-num" data-tone="gold">2<\/span>/);
    expect(out).toContain('data-lawoss-waiting="filing"');
    expect(out).not.toContain('data-lawoss-waiting="confirm"');
  });

  test("otvorené úlohy: úloha zo zdieľaného súboru raz", () => {
    const shared = { id: "T1", title: "Spoločná", file: "Klienti/Tatran/memory/T1.md" };
    expect(openTaskTotal([matter("A", { openTasks: [shared, { id: "T2", title: "Vlastná" }] }), matter("B", { openTasks: [shared] })])).toBe(2);
  });

  test("iniciály z prvých dvoch slov", () => {
    expect(clientInitials("Tatran Automatika, s. r. o.")).toBe("TA");
    expect(clientInitials("SYN Tatran Automatika")).toBe("ST");
    expect(clientInitials("  „Novák“ ")).toBe("N");
    expect(clientInitials("")).toBe("");
  });
});

describe("karty prípadov", () => {
  test("štítok termínu: neplatný dátum má prednosť, potom po termíne, termín podľa naliehavosti, bez termínu tlmene", () => {
    const term = { kind: "deadline" as const, date: "2026-11-17", title: "L", overdue: false };
    expect(cardPill({ invalid: "31. 2. 2026", term }, TODAY)).toEqual({ kind: "invalid", raw: "31. 2. 2026" });
    expect(cardPill({ term: { ...term, date: "2026-11-10", overdue: true } }, TODAY)).toMatchObject({ kind: "late" });
    expect(cardPill({ term }, TODAY)).toMatchObject({ kind: "due", daysLeft: 3, tone: "red" });
    expect(cardPill({ term: { ...term, date: "2026-11-30" } }, TODAY)).toMatchObject({ tone: "neutral" });
    expect(cardPill({ term: { ...term, kind: "work" } }, TODAY)).toMatchObject({ tone: "work" });
    expect(cardPill({}, TODAY)).toEqual({ kind: "none" });
    // Uplynulý pracovný termín: karta povie „po termíne“ ako panel „Čaká na vás“, nie „bez termínu“.
    const passed = { openTasks: [{ id: "T", title: "Fotodokumentácia", due: "2026-11-10" }] };
    expect(cardPill({ matter: passed }, TODAY)).toMatchObject({ kind: "late", term: { kind: "work", date: "2026-11-10" } });
    expect(cardPill({ matter: passed, term }, TODAY)).toMatchObject({ kind: "late" });
    const vady = view().match(/<a class="lw-dnes-card lw-klient-card" title="Vady rekonštrukcie".*?<\/a>/)?.[0] ?? "";
    expect(vady).toContain(">po termíne<");
    expect(vady).not.toContain("bez termínu");
  });

  test("fáza len ak je zapísaná; chýbajúca je jeden tichý riadok pod kartami, nie na každej karte", () => {
    const matters = Array.from({ length: 7 }, (_, i) => matter(`Klienti/Tatran/Spisy/M${i}`));
    const statuses = { [matters[0]!.path]: { phase: "Píšeme vyjadrenie", nextStep: "Doplniť prílohu č. 4", stale: true as const } };
    expect(phaseMissing(caseCards(matters, statuses, TODAY))).toBe(6);
    const out = view({ matters, statuses, deadlines: [], today: undefined });
    expect(out).toContain("Píšeme vyjadrenie");
    expect(out).toContain("môže byť neaktuálne");
    expect(out).toContain("Doplniť prílohu č. 4");
    expect(out).not.toContain("Fáza neevidovaná");
    expect(out).toContain('data-lawoss-phase-missing="6"');
    expect(out).toContain("Fáza nie je evidovaná pri 6 prípadoch");
    expect(out.match(/class="lw-dnes-card lw-klient-card"/g)?.length).toBe(CARDS_SHOWN);
    expect(out).toContain("Zobraziť všetky prípady (7)");
    // Pruh krokov „3 z 5“ nemá zdroj.
    expect(out).not.toMatch(/krok \d z \d/);
  });

  test("druh, spisová značka a súd, štítok „o 3 dni“ a počet úloh; N-A7-4 neplatný dátum namiesto „bez termínu“", () => {
    const out = view({ kinds: { [UHRADA]: "Konanie" } });
    expect(out).toContain('data-lawoss-matter-kind="" title="Konanie">Konanie</span>');
    expect(out).toContain("12Cb/45/2026 · MS Košice");
    expect(out).toMatch(/data-tone="red" data-kind="deadline"[^>]*>o 3 dni</);
    expect(out).toContain("Úlohy 1");
    expect(out).toContain('data-lawoss-kinds="">Konanie 1</span>');
    const invalid = [matter("X", { openTasks: [{ id: "T", title: "Zlý", due: "31. 2. 2026", invalid: true }] })];
    const bad = view({ matters: invalid, deadlines: [], today: undefined });
    expect(bad).toContain("? 31. 2. 2026 · overiť dátum");
    expect(bad).not.toContain("bez termínu");
  });
});

describe("poctivé stavy ako tiché riadky", () => {
  test("čiastočné čítanie a #264 cudzie priečinky", () => {
    const out = view({ partial: true, foreignFolders: ["C099 SYN Vnoreny"] });
    expect(out).toContain("data-lawoss-client-overview-partial");
    expect(out).toContain("data-lawoss-client-overview-foreign");
    expect(out).toContain("Priečinky iného klienta, nie sú v prehľade: C099 SYN Vnoreny");
    expect(view()).not.toContain("data-lawoss-client-overview-partial");
  });

  test("#242 lehoty: neevidované, nenačítané, a počet prípadov bez lehôt pri čiastočnej evidencii", () => {
    const none = { deadlines: [], today: undefined };
    expect(view({ ...none, deadlineEvidence: { recorded: 0, unrecorded: 2 } })).toContain('data-lawoss-deadlines="unrecorded"');
    expect(view({ ...none, deadlineEvidence: { recorded: 0, unrecorded: 2 } })).toContain("Lehoty nie sú v podkladoch evidované.");
    expect(view({ ...none, readFailed: true })).toContain('data-lawoss-deadlines="not_loaded"');
    expect(view({ ...none, deadlineEvidence: { recorded: 1, unrecorded: 0 } })).toContain("Žiadne nadchádzajúce evidované lehoty");
    const partial = view({ deadlineEvidence: { recorded: 1, unrecorded: 3 } });
    expect(partial).toContain('data-lawoss-deadlines="partial"');
    expect(partial).toContain("Prípady bez evidovaných lehôt: 3.");
    expect(partial).toContain(`href="${clientDeadlinesLink("tatran")}"`);
  });

  test("vstupy: počty jedným riadkom, neevidované, nenačítané a čiastočné; bez prstenca", () => {
    const counts = inputCounts(data.inputs, data.matters.map((m) => m.path));
    const out = view({ inputs: counts });
    expect(out).toContain('data-lawoss-inputs="3"');
    expect(out).toContain("Dôkazy <b>0</b>");
    expect(out).not.toContain("lw-client-ring");
    expect(view({ inputs: null })).toContain('data-lawoss-inputs="unrecorded"');
    expect(view({ inputs: null })).toContain("Vstupy nie sú evidované.");
    expect(view({ inputs: null, inputsFailed: true })).toContain('data-lawoss-inputs="not_loaded"');
    expect(view({ inputs: null, inputsFailed: true })).not.toContain("Vstupy nie sú evidované.");
    expect(view({ inputs: counts, inputsFailed: true })).toContain("data-lawoss-inputs-partial");
  });

  test("načítanie úloh: kostra, nie nula; „nič nečaká“ len pri úplnom čítaní", () => {
    const empty = { matters: [], deadlines: [], today: buildToday({ ...buildOverview([], TODAY), inputs: [] }, TODAY) };
    const pending = view({ ...empty, pending: true });
    expect(pending.match(/data-lawoss-tile="waiting"[^>]*>.*?<\/div>/)?.[0]).toContain("data-lawoss-skeleton");
    expect(view(empty)).toContain("nič nečaká");
    expect(view({ ...empty, partial: true })).not.toContain("nič nečaká");
  });
});

describe("zoznam lehôt a Pokračovať", () => {
  test("najviac päť lehôt v poradí registra, podľa pokynu so štítkom, neplatná bez počtu dní", () => {
    const list = [deadline("2026-11-15", { basis: "instruction" }), deadline("31. 2.", { invalid: true, raw: "31. 2." }), ...["16", "17", "18", "19"].map((d) => deadline(`2026-11-${d}`))];
    const { rows, more } = clientDeadlineRows(list, TODAY, 5);
    expect(rows.map((row) => [row.origin, row.daysLeft, row.tone])).toEqual([["instruction", 1, "red"], ["recorded", null, "red"], ["recorded", 2, "red"], ["recorded", 3, "red"], ["recorded", 4, "amber"]]);
    expect(more).toBe(1);
    const out = view({ deadlines: list });
    expect(out).toContain("podľa pokynu · overiť");
    expect(out).toContain("+1 ďalšie · Všetky lehoty klienta");
  });

  test("posledné chaty len z načítaného zoznamu panela; bez nich blok nie je", () => {
    const groups = [
      { workspace: { id: "tatran" }, status: "ready", sessions: [
        { id: "a", title: "Starší", time: { updated: 1 } }, { id: "b", title: "Novší", time: { updated: 5 } },
        { id: "c", title: "Archív", time: { updated: 9, archived: 9 } }, { id: "d", title: "Podriadený", parentID: "b", time: { updated: 8 } },
        { id: "e", title: "Tretí", time: { created: 3 } }, { id: "f", title: "Štvrtý", time: { updated: 2 } },
      ] },
      { workspace: { id: "hron" }, status: "loading", sessions: [{ id: "x", title: "Iný", time: { updated: 1 } }] },
    ];
    const chats = recentChats(groups, 3);
    expect(chats.tatran?.map((c) => c.id)).toEqual(["b", "e", "f"]);
    expect(chats.hron).toBeUndefined();
    expect(view({ chats: chats.tatran })).toContain('data-lawoss-chat="b"');
    expect(view()).not.toContain("lw-klient-continue");
    // Nová správa v chate v ten istý deň zverejnený stav panela nemení; nový chat áno.
    const later = recentChats([{ ...groups[0]!, sessions: groups[0]!.sessions.map((x) => x.id === "b" ? { ...x, time: { updated: 6 } } : x) }], 3);
    expect(recentChatsKey(later)).toBe(recentChatsKey({ tatran: chats.tatran ?? [] }));
    const added = recentChats([{ ...groups[0]!, sessions: [...groups[0]!.sessions, { id: "g", title: "Nový", time: { updated: 7 } }] }], 3);
    expect(recentChatsKey(added)).not.toBe(recentChatsKey({ tatran: chats.tatran ?? [] }));
  });
});

describe("pole chatu a stránka", () => {
  test("návrhy: nové u klienta, zaradenie len pri nezaradených, lehoty klienta; nie „Založ nový prípad“", () => {
    const out = view();
    expect(out).toContain("data-lawoss-chatbar");
    expect(out).toContain("Čo je u tohto klienta nové?");
    expect(out).toContain("Zaraď nové dokumenty");
    expect(out).toContain("Skontroluj lehoty tohto klienta");
    expect(out).not.toContain("Založ nový prípad");
    const filed = { ...buildOverview([inputs[1]!], TODAY), inputs: [inputs[1]!] };
    expect(view({ matters: filed.matters, today: buildToday(filed, TODAY) })).not.toContain("Zaraď nové dokumenty");
    expect(view({ chat: false })).not.toContain("data-lawoss-chatbar");
    // Nič sa neodosiela: veta ide cez pamäť (home-prefill) a Domov otvorí nový chat tohto klienta.
    expect(homeRoute("tatran")).toBe("/home?project=tatran");
    expect(source("lawoss/lite/pages/today-page.tsx")).toMatch(/requestHomePrefill\(value\);\s*navigate\(homeRoute\(projectId\)\);/);
  });

  test("pás 14 dní ako dlaždica, prepínač Prehľad / Mesiac, pripojené priečinky zbalené", () => {
    const out = view({ events: [], folders: <p data-test-folders="">priečinky</p> });
    expect(out).toContain('<section class="lw-today-strip"');
    expect(out).toContain("data-compact");
    expect(out).toContain('data-lawoss-mode="overview"');
    expect(out).toContain('data-lawoss-client-folders="closed"');
    expect(out).not.toContain("data-test-folders");
    expect(out).toContain(`href="${liteMatterLink(UHRADA)}"`);
  });

  test("upstream hlavička: štruktúra, na ktorú sa spolieha skrytie „Nový chat“, a hák `leading`", () => {
    const home = source("react-app/domains/workspace/project-home.tsx");
    // header > div (názov) + div (riadok tlačidiel), ktorého prvá skupina je „Nový chat“.
    expect(home).toMatch(/<header [^>]*\/>\}>\s*<div className="flex flex-col[^"]*">\s*\{props\.leading[^}]*\}\s*<ProjectName/);
    expect(home).toMatch(/<\/div>\s*<\/div>\s*<div className="mt-5 flex flex-wrap items-center gap-1\.5">\s*<div className="inline-flex rounded-xl shadow-xs">\s*<Button size="lg"[^>]*>[\s\S]{0,400}?\{t\("projects\.new_chat"\)\}/);
    expect(source("react-app/domains/session/chat/session-page.tsx")).toContain("leading={<ClientInitials workspaceId={props.selectedWorkspaceId} name={projectName} />}");
    const css = source("lawoss/lite/pages/client-dashboard.css");
    expect(css).toContain(':root[data-lawoss-ui="lite"] [data-testid="project-home"]:has([data-lawoss-chatbar]) .lw-project-home-header header > div:nth-child(2) > div:first-child { display: none; }');
    expect(css).toContain("A5:");
    expect(css).toContain("prefers-reduced-motion");
  });

  test("texty vo všetkých štyroch jazykoch, bez skladania kľúča za behu", () => {
    for (const dict of [shellEn, shellCs, shellSk, shellDe]) {
      for (const key of ["client_chat_suggest_new", "client_chat_suggest_deadlines", "client_phase_missing_one", "client_phase_missing_other"]) expect(dict).toHaveProperty([`lawoss.lite.${key}`]);
    }
    for (const dict of [shellCs, shellSk]) for (const key of ["client_phase_missing_few", "client_phase_missing_many"]) expect(dict).toHaveProperty([`lawoss.lite.${key}`]);
    expect(source("lawoss/lite/client-dashboard.tsx")).not.toContain("`lawoss.lite.${");
    expect(source("lawoss/lite/client-dashboard.tsx")).not.toMatch(/text\(`/);
  });
});
