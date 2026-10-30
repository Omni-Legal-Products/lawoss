import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { join } from "node:path";
import type { OkfScope } from "../src/lawoss/okf/read-model";

// N-A5-6 (UI test dev 25. 10. 2026): titulok okna „C002-syn-hron-technologie-a-s · Prehľad“ a bočný panel počas
// načítavania so slugmi „C024-syn-tomas-sve…“. Meno z karty klienta sa ukáže namiesto mena priečinka, len na
// zobrazenie: meno priestoru (server, exporty dokumentov, premenovanie v nastaveniach) sa nemení.

// Úplné úložisko na globalThis aj window pred importom kódu appky; po testoch sa vrátia pôvodné deskriptory.
const store = new Map<string, string>();
const storage: Storage = {
  get length() { return store.size; },
  key: (index: number) => [...store.keys()][index] ?? null,
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, String(value)),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
};
const targets: object[] = [globalThis, ...(typeof window === "undefined" ? [] : [window])];
const prior = targets.map((target) => Object.getOwnPropertyDescriptor(target, "localStorage"));
for (const target of targets) Object.defineProperty(target, "localStorage", { configurable: true, value: storage });
afterAll(() => { resetCardTitlesForTest(); });
afterAll(() => targets.forEach((target, index) => {
  const descriptor = prior[index];
  if (descriptor) Object.defineProperty(target, "localStorage", descriptor); else Reflect.deleteProperty(target, "localStorage");
}));

const { cardTitles, cleanTitle, clientCardLabel, rememberCardTitles, resetCardTitlesForTest } = await import("../src/lawoss/lite/client-titles");
const { clientProjectRow, useClientDisplayName, useClientProjectRow } = await import("../src/lawoss/lite/client-row-view");
const { buildClientRows } = await import("../src/lawoss/lite/client-row-data");
const { workspaceLabel } = await import("../src/react-app/shell/route-workspaces");

const ROOT = "/Users/advokat/AK/Klienti";
const FOLDER = "C002-syn-hron-technologie-a-s";
const TITLE = "SYN Hron Technológie, a. s.";
const c002 = { id: "c002", path: `${ROOT}/${FOLDER}`, name: FOLDER, workspaceType: "local" as const };
const scope: OkfScope = {
  anchor: { ...c002, displayNameResolved: FOLDER },
  members: [{ workspace: { ...c002, displayNameResolved: FOLDER }, prefix: FOLDER }],
  practiceRoot: ROOT,
};
const remember = (title?: string) => rememberCardTitles(cardTitles([c002], scope, [{ path: FOLDER, ...(title === undefined ? {} : { title }) }]));

beforeEach(() => { store.clear(); resetCardTitlesForTest(); });

describe("meno z karty klienta namiesto mena priečinka", () => {
  test("bočný panel počas načítavania: meno z karty zapamätané z prehľadu, aj po ďalšom štarte", () => {
    // Prvý štart pred prehľadom: zatiaľ meno priečinka.
    expect(clientProjectRow(null, c002, FOLDER, "sk").label).toBe(FOLDER);
    remember(TITLE);
    resetCardTitlesForTest();
    const row = clientProjectRow(null, c002, FOLDER, "sk");
    expect(row.label).toBe(TITLE);
    // Natívne meno (natívne pomocníky ho hľadajú presne) ostáva.
    expect(row.nativeLabel).toBe(FOLDER);
  });

  test("review: aj po pripojení, kým prehľad nie je načítaný (fakty `pending`), a v skutočnom hooku panela", () => {
    remember(TITLE);
    const rows = (data: Parameters<typeof buildClientRows>[0]["data"], excluded: string[] = [], reading = true) => buildClientRows({ workspaces: [c002], scope, data,
      groups: [], model: { clients: new Map() }, excludedWorkspaceIds: excluded, rootCards: new Map(), todayIso: "2026-10-25", reading });
    expect(rows(undefined).get("c002")).toMatchObject({ eligible: false, pending: true });
    expect(clientProjectRow({ rows: rows(undefined) }, c002, FOLDER, "sk").label).toBe(TITLE);
    // Prehľad zlyhal alebo nemá rozsah (nečíta sa): zapamätané meno sa neukazuje donekonečna.
    expect(rows(undefined, [], false).get("c002")?.pending).toBeUndefined();
    // Vylúčený priestor ostáva pri natívnom mene.
    expect(rows(undefined, ["c002"]).get("c002")?.pending).toBeUndefined();
    expect(clientProjectRow({ rows: rows(undefined, ["c002"]) }, c002, FOLDER, "sk").label).toBe(FOLDER);
    // Hook, ktorý volá bočný panel (bez panela = bez faktov).
    const Row = () => createElement("span", null, useClientProjectRow(c002, FOLDER).label);
    expect(renderToStaticMarkup(createElement(Row))).toContain(TITLE);
  });

  test("meno priestoru sa nemení: premenovanie v nastaveniach a exporty dostanú meno priečinka", () => {
    remember(TITLE);
    expect(workspaceLabel({ ...c002 })).toBe(FOLDER);
  });

  test("premenovaný alebo presunutý priestor, vzdialený priestor či chýbajúca karta: bez mena z karty", () => {
    remember(TITLE);
    expect(clientCardLabel("c002", "Hron (môj názov)")).toBeUndefined();
    expect(clientCardLabel("c002", "iny-priecinok")).toBeUndefined();
    expect(clientCardLabel("c002", FOLDER, `/inde/${FOLDER}`)).toBeUndefined();
    expect(clientCardLabel("c002", FOLDER, c002.path)).toBe(TITLE);
    expect(cardTitles([{ ...c002, workspaceType: "remote" }], scope, [{ path: FOLDER, title: TITLE }])).toEqual([]);
    expect(cardTitles([{ ...c002, displayName: "Hron" }], scope, [{ path: FOLDER, title: TITLE }])).toEqual([]);
    expect(cardTitles([c002], null, [{ path: FOLDER, title: TITLE }])).toEqual([]);
    // Klient, ktorého prehľad nepozná, sa nemení.
    expect(cardTitles([c002], scope, [])).toEqual([]);
  });

  // #273: titulok okna a hlavička Prehľadu (`useClientDisplayName`) volali riadok bez cesty a stráž cesty preskočili.
  test("titulok okna a hlavička Prehľadu: priestor presmerovaný do inej praxe nemá meno predchádzajúceho klienta (#273)", () => {
    remember(TITLE);
    const Name = ({ path }: { path: string }) => createElement("span", null, useClientDisplayName("c002", FOLDER, path));
    expect(renderToStaticMarkup(createElement(Name, { path: `/B/Klienti/${FOLDER}` }))).toBe(`<span>${FOLDER}</span>`);
    expect(renderToStaticMarkup(createElement(Name, { path: c002.path }))).toBe(`<span>${TITLE}</span>`);
  });

  test("karta stratí meno alebo sa volá ako priečinok: zapamätané meno sa zabudne", () => {
    remember(TITLE);
    remember();
    expect(clientCardLabel("c002", FOLDER)).toBeUndefined();
    remember(TITLE);
    remember(FOLDER);
    resetCardTitlesForTest();
    expect(clientCardLabel("c002", FOLDER)).toBeUndefined();
    // Review: karta, ktorá sa práve nedala prečítať (neúplné čítanie), meno nezmaže.
    remember(TITLE);
    rememberCardTitles(cardTitles([c002], scope, [{ path: FOLDER }], false));
    expect(clientCardLabel("c002", FOLDER)).toBe(TITLE);
    // Odstránený priestor sa zo záznamu zahodí.
    rememberCardTitles([], ["iny"]);
    expect(clientCardLabel("c002", FOLDER)).toBeUndefined();
  });

  test("meno z karty len v tvare, ktorý server prijme (šablóna, úvodzovky, riadiace znaky, dĺžka)", () => {
    expect(cleanTitle("  SYN Hron\u0007\nTechnológie  ")).toBe("SYN Hron Technológie");
    expect(cleanTitle("{{KLIENT}}")).toBeUndefined();
    expect(cleanTitle(">")).toBeUndefined();
    // Úvodzovky odstráni už čítanie karty; zvyšné patria k menu (ako v načítanom riadku).
    expect(cleanTitle("'SYN Hron, a. s.'")).toBe("'SYN Hron, a. s.'");
    expect(cleanTitle("x".repeat(201))).toBeUndefined();
    expect(cardTitles([c002], scope, [{ path: FOLDER, title: "{{KLIENT}}" }])).toEqual([{ id: "c002", path: c002.path, title: null }]);
  });

  test("titulok okna berie meno z riadku bočného panela (strážca väzby)", () => {
    // SSR celej SessionPage je mimo rozsahu; väzbu titulku na `useClientDisplayName` stráži zdroj.
    const page = readFileSync(join(import.meta.dir, "../src/react-app/domains/session/chat/session-page.tsx"), "utf8");
    expect(page).toContain("const titleName = projectName !== props.selectedWorkspaceId ? projectName : workspaceName;");
    expect(page).toContain("props.projectPage ? `${titleName} · ${projectViewLabel(props.projectPage)}`");
  });
});
