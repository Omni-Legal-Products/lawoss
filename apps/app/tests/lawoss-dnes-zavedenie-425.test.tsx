import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { TodayView } from "../src/lawoss/lite/pages/today-page";
import { adoptLink, waitingCounts, waitingLink, type TodayModel } from "../src/lawoss/lite/today-model";
import { LEHOTY_PATH, LITE_INPUTS_PATH } from "../src/lawoss/lite/links";

// #425: priečinok vložený ručne do `Klienti/` sa na Dnes ponúkne „na zavedenie“; dlaždica len naviguje do sprievodcu.
const html = (node: ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
const now = new Date("2026-11-15T09:00:00");
const empty: TodayModel = { deadlines: [], tasks: [], inputs: [], recent: [] };
const evidence = { complete: true, recorded: 1, unrecorded: 0 };
const NOVAK = { path: "/Users/syn/Kancelaria/Klienti/SYN Novák s.r.o.", name: "SYN Novák s.r.o." };
const ALFA = { path: "/Users/syn/Kancelaria/Klienti/SYN Alfa", name: "SYN Alfa" };
const minis = (markup: string) => [...markup.matchAll(/data-lawoss-waiting="([a-z]+)"/g)].map((match) => match[1]);
const decode = (value: string) => value.replace(/&amp;/g, "&");

describe("Čaká na vás: na zavedenie (#425)", () => {
  test("počet priečinkov ide do súčtu; bez priečinkov je 0 a súčet sa nemení", () => {
    const base = { inputs: 1, deadlines: [], dates: [], unreadable: [] };
    expect(waitingCounts(base)).toMatchObject({ adopt: 0, total: 1 });
    expect(waitingCounts({ ...base, unadopted: 2 })).toMatchObject({ filing: 1, adopt: 2, total: 3 });
  });

  test("odkaz zavedenia otvorí „Toto sme našli“ s cestou prvého priečinka podľa mena; bez priečinkov nič", () => {
    expect(adoptLink([])).toBeNull();
    const link = adoptLink([NOVAK, ALFA]);
    expect(link).not.toBeNull();
    const url = new URL(link ?? "", "app://x");
    expect(url.pathname).toBe("/welcome");
    expect(url.searchParams.get("continue")).toBe("folder");
    expect(url.searchParams.get("root")).toBe(ALFA.path);
  });

  test("horná dlaždica vedie na zavedenie len vtedy, keď nič iné nečaká", () => {
    const link = adoptLink([NOVAK]);
    expect(waitingLink(waitingCounts({ inputs: 0, deadlines: [], dates: [], unreadable: [], unadopted: 1 }), link)).toBe(link ?? "");
    expect(waitingLink(waitingCounts({ inputs: 2, deadlines: [], dates: [], unreadable: [], unadopted: 1 }), link)).toBe(LEHOTY_PATH);
    expect(waitingLink(waitingCounts({ inputs: 2, deadlines: [], dates: [], unreadable: [] }), link)).toBe(LITE_INPUTS_PATH);
  });

  test("dlaždica sa ukáže len pri počte > 0; tri doterajšie ostanú v rovnakom poradí", () => {
    const none = html(<TodayView model={empty} locale="sk" now={now} evidence={evidence} />);
    expect(minis(none)).toEqual(["filing", "overdue", "verify"]);
    expect(none).not.toContain("na zavedenie");
    const some = html(<TodayView model={empty} locale="sk" now={now} evidence={evidence} unadopted={[NOVAK]} />);
    expect(minis(some)).toEqual(["filing", "overdue", "verify", "adopt"]);
    const tile = some.match(/<a [^>]*data-lawoss-waiting="adopt"[^>]*>.*?<\/a>/)?.[0] ?? "";
    expect(tile).toContain("<b>1</b>");
    expect(tile).toContain(">na zavedenie<");
    // Odkaz nesie cestu priečinka do obrazovky „Toto sme našli“ (bez natívneho výberu priečinka).
    const href = decode(tile.match(/href="([^"]+)"/)?.[1] ?? "");
    expect(new URL(href, "app://x").searchParams.get("root")).toBe(NOVAK.path);
    // Horná dlaždica „Čaká na vás“ ho započíta a vedie tam tiež (nič iné nečaká).
    const top = some.match(/<a [^>]*data-lawoss-tile="waiting"[^>]*>.*?<\/a>/)?.[0] ?? "";
    expect(top).toContain(">1</span>");
    expect(top).toContain("1 na zavedenie");
    expect(decode(top.match(/href="([^"]+)"/)?.[1] ?? "")).toBe(href);
    expect(html(<TodayView model={empty} locale="cs" now={now} evidence={evidence} unadopted={[NOVAK]} />)).toContain(">k zavedení<");
  });

  test("cesta z odkazu otvorí sprievodcu rovno na zvolenom priečinku", () => {
    const route = readFileSync(join(import.meta.dir, "../src/react-app/shell/welcome-route.tsx"), "utf8");
    expect(route).toContain('initialRoot={new URLSearchParams(location.search).get("root") ?? undefined}');
    const page = readFileSync(join(import.meta.dir, "../src/lawoss/domains/onboarding/lawoss-welcome-page.tsx"), "utf8");
    expect(page).toContain("const [foundRoot, setFoundRoot] = useState<string | null>(initialRoot ?? null);");
  });
});
