import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cardTitles, cleanTitle, clientCardLabel, rememberCardTitles, resetCardTitlesForTest } from "../src/lawoss/lite/client-titles";
import { mapDesktopWorkspace, workspaceLabel } from "../src/react-app/shell/route-workspaces";
import type { OkfScope } from "../src/lawoss/okf/read-model";

// N-A5-6 (UI test dev 25. 10. 2026): titulok okna „C002-syn-hron-technologie-a-s · Prehľad“ a bočný panel počas
// načítavania so slugmi „C024-syn-tomas-sve…“. Meno z karty klienta sa ukáže namiesto mena priečinka, len na
// zobrazenie: meno priestoru na serveri (identita exportov dokumentov) sa nemení.

const ROOT = "/Users/advokat/AK/Klienti";
const FOLDER = "C002-syn-hron-technologie-a-s";
const c002 = { id: "c002", path: `${ROOT}/${FOLDER}`, name: FOLDER, workspaceType: "local" as const };
const scope: OkfScope = {
  anchor: { ...c002, displayNameResolved: FOLDER },
  members: [{ workspace: { ...c002, displayNameResolved: FOLDER }, prefix: FOLDER }],
  practiceRoot: ROOT,
};
const clients = [{ path: FOLDER, title: "SYN Hron Technológie, a. s." }];

const store = new Map<string, string>();
const prior = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key), clear: () => store.clear(), key: () => null, length: 0,
  } });
  resetCardTitlesForTest();
});
afterEach(() => {
  if (prior) Object.defineProperty(globalThis, "localStorage", prior); else Reflect.deleteProperty(globalThis, "localStorage");
  resetCardTitlesForTest();
});

describe("meno z karty klienta namiesto mena priečinka", () => {
  test("titulok okna aj panel: po načítaní prehľadu meno z karty, meno priestoru ostáva", () => {
    expect(workspaceLabel({ ...c002 })).toBe(FOLDER);
    rememberCardTitles(cardTitles([c002], scope, clients));
    expect(workspaceLabel({ ...c002 })).toBe("SYN Hron Technológie, a. s.");
    const mapped = mapDesktopWorkspace({ ...c002 });
    expect(mapped.displayNameResolved).toBe("SYN Hron Technológie, a. s.");
    expect(mapped.name).toBe(FOLDER);
  });

  test("ďalší štart: meno z karty hneď, ešte pred načítaním prehľadu", () => {
    rememberCardTitles(cardTitles([c002], scope, clients));
    resetCardTitlesForTest();
    expect(clientCardLabel(c002)).toBe("SYN Hron Technológie, a. s.");
    // Iný priečinok pod tým istým id (priestor presunutý): meno z karty sa nepoužije.
    expect(clientCardLabel({ ...c002, path: `${ROOT}/iny` })).toBeUndefined();
  });

  test("meno zvolené advokátom, vzdialený priestor či chýbajúca karta: bez zmeny", () => {
    rememberCardTitles(cardTitles([c002], scope, clients));
    expect(workspaceLabel({ ...c002, displayName: "Hron (môj názov)" })).toBe("Hron (môj názov)");
    expect(workspaceLabel({ ...c002, name: "Hron – vlastné meno" })).toBe("Hron – vlastné meno");
    expect(cardTitles([{ ...c002, workspaceType: "remote" }], scope, clients)).toEqual([]);
    expect(cardTitles([c002], scope, [{ path: FOLDER }])).toEqual([]);
    expect(cardTitles([c002], null, clients)).toEqual([]);
  });

  test("meno z karty len v tvare, ktorý server prijme (šablóna, úvodzovky, riadiace znaky, dĺžka)", () => {
    expect(cleanTitle("  SYN Hron\u0007\nTechnológie  ")).toBe("SYN Hron Technológie");
    expect(cleanTitle("{{KLIENT}}")).toBeUndefined();
    expect(cleanTitle(">")).toBeUndefined();
    expect(cleanTitle("'SYN Hron, a. s.'")).toBeUndefined();
    expect(cleanTitle("x".repeat(201))).toBeUndefined();
    expect(cardTitles([c002], scope, [{ path: FOLDER, title: "{{KLIENT}}" }])).toEqual([]);
  });
});
