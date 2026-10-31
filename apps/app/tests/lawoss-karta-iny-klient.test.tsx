/** @jsxImportSource react */
// N-A7-14 (test E2, 28. 10. 2026): karta „Pristúpiť k externému priečinku?“ v chate klienta C001 pri rozsahu
// `…/Klienti/C002*/*` povie, že priečinok patrí inému klientovi, s jeho menom. Klient = priečinok s kartou klienta
// z prehľadu (review #295: spisy toho istého klienta nie sú iný klient). Syntetická prax /Users/advokat/Prax.
import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { currentLocale, setLocale, type Language } from "../src/i18n";
import type { PendingPermission } from "../src/app/types";
import { ClientNavTestProvider } from "../src/lawoss/lite/client-nav";
import { clientDisplayName, otherClientFolder, otherClientFolderText, type CardClient } from "../src/lawoss/lite/other-client-folder";
import { PermissionApprovalPanel } from "../src/react-app/domains/session/chat/permission-approval-modal";

const P = "/Users/advokat/Prax";
const c001 = `${P}/Klienti/C001-syn-tatran-automatika`, c002 = `${P}/Klienti/C002-syn-hron-technologie`, c003 = `${P}/Klienti/C003-syn-orava`;
const clients: CardClient[] = [
  { folder: c001, name: "SYN Tatran Automatika, s. r. o." },
  { folder: c002, name: "SYN Hron Technológie, a. s." },
  { folder: c003, name: "SYN Orava, s. r. o." },
];
const hron = { kind: "inside", name: "SYN Hron Technológie, a. s." };
const contains = { kind: "contains", names: ["SYN Hron Technológie, a. s.", "SYN Orava, s. r. o."] };

const original = currentLocale();
afterEach(() => setLocale(original));

describe("priečinok iného klienta", () => {
  test("rozsah v inom klientovi, vzor `C002*` hľadania aj z chatu spisu: meno toho klienta", () => {
    for (const chat of [c001, `${c001}/Spisy/M001 Úhrada`]) {
      for (const pattern of [`${P}/Klienti/C002*/*`, `${c002}/*`, `${c002}/Spisy/M004/*`, `${P}/Klienti/c002-SYN-hron*/*`, `${P}/*/C002-syn-hron-technologie/*`])
        expect(otherClientFolder([pattern], chat, clients)).toEqual(hron);
    }
  });

  test("spisy toho istého klienta, vlastný klient a pripojený priečinok mimo praxe: nič", () => {
    for (const patterns of [[`${c001}/Spisy/M002 Nájom/*`], [`${c001}/*`], ["/Users/advokat/Zdielane/Vzory/*"], [`${P}/Vzory/*`], [`${P}/Klienti/C001*/*`], [c002]])
      expect(otherClientFolder(patterns, `${c001}/Spisy/M001 Úhrada`, clients)).toBeNull();
    // Chat mimo známeho klienta (koreň praxe, iný priečinok) sa nerieši.
    for (const chat of [P, "/Users/advokat/Iny", ""]) expect(otherClientFolder([`${c002}/*`], chat, clients)).toBeNull();
  });

  test("priečinok alebo vzor cez viacerých klientov (aj vlastného): mená iných klientov", () => {
    for (const pattern of [`${P}/Klienti/*`, `${P}/Klienti/*/*`, `${P}/K*/*`, `${P}/Klienti/C00*/*`, `${P}/**/*`])
      expect(otherClientFolder([pattern], c001, clients)).toEqual(contains);
    // Vzor, ktorý sa rozvinie na dvoch iných klientov (bez vlastného): ich mená.
    expect(otherClientFolder([`${P}/Klienti/C00?-syn-[ho]*/*`], c001, clients)).toEqual({ kind: "uncertain" });
    expect(otherClientFolder([`${P}/Klienti/*-syn-hron*/*`], c001, [...clients, { folder: `${P}/Klienti/C004-syn-hron-druhy`, name: "SYN Hron II" }]))
      .toEqual({ kind: "contains", names: ["SYN Hron Technológie, a. s.", "SYN Hron II"] });
    // Neistý rozsah popri jasnom inom klientovi: meno klienta.
    expect(otherClientFolder([`${P}/Klienti/C00[23]*/*`, `${c002}/*`], c001, clients)).toEqual(hron);
  });

  test("neisté znaky `[ ] { } $ \\``: varovanie, nie ticho", () => {
    for (const pattern of [`${P}/Klienti/C00[2]-x/*`, `${P}/Klienti/{C002,C003}/*`, "$HOME/Prax/Klienti/*", `${P}/\`ls\`/*`])
      expect(otherClientFolder([pattern], c001, clients)).toEqual({ kind: "uncertain" });
  });

  // Rozhodnutie MČ 31. 10. 2026: priečinok iného klienta sa neodmieta, karta výrazne varuje kódom a menom klienta.
  test("varovanie karty po slovensky, česky, anglicky aj nemecky: kód a meno klienta, najviac traja a počet ďalších", () => {
    const name = "C002 SYN Hron Technológie, a. s.";
    const expected: Record<Language, [string, string]> = {
      sk: [`Pozor: priečinok patrí inému klientovi (${name}). Ak ho povolíte, agent uvidí jeho súbory.`, "Pozor: priečinok obsahuje priečinky iných klientov (C002 A, C003 B, C004 C a ďalší 2). Ak ho povolíte, agent uvidí ich súbory."],
      cs: [`Pozor: složka patří jinému klientovi (${name}). Pokud ji povolíte, agent uvidí jeho soubory.`, "Pozor: složka obsahuje složky jiných klientů (C002 A, C003 B, C004 C a další 2). Pokud ji povolíte, agent uvidí jejich soubory."],
      en: [`Warning: this folder belongs to another client (${name}). If you allow it, the agent will see that client's files.`, "Warning: this folder contains folders of other clients (C002 A, C003 B, C004 C and 2 more). If you allow it, the agent will see their files."],
      de: [`Achtung: Dieser Ordner gehört einem anderen Mandanten (${name}). Wenn Sie ihn freigeben, sieht der Agent dessen Dateien.`, "Achtung: Dieser Ordner enthält Ordner anderer Mandanten (C002 A, C003 B, C004 C und 2 weitere). Wenn Sie ihn freigeben, sieht der Agent deren Dateien."],
    } as Record<Language, [string, string]>;
    for (const [locale, [inside, many]] of Object.entries(expected)) {
      setLocale(locale as Language);
      expect(otherClientFolderText({ kind: "inside", name })).toBe(inside);
      expect(otherClientFolderText({ kind: "contains", names: ["C002 A", "C003 B", "C004 C", "C005 D", "C006 E"] })).toBe(many);
    }
    setLocale("sk");
    expect(otherClientFolderText({ kind: "contains", names: ["C002 A", "C003 B"] })).toBe("Pozor: priečinok obsahuje priečinky iných klientov (C002 A, C003 B). Ak ho povolíte, agent uvidí ich súbory.");
    expect(otherClientFolderText({ kind: "uncertain" })).toBe("Pozor: pri tejto ceste sa nedá overiť, či nesiaha do priečinka iného klienta. Pred povolením ju skontrolujte.");
  });

  test("meno klienta na karte: kód z priečinka pred menom z karty, ak ho meno ešte nemá", () => {
    expect(clientDisplayName(c002, "SYN Hron Technológie, a. s.")).toBe("C002 SYN Hron Technológie, a. s.");
    expect(clientDisplayName(c002, "C002 SYN Hron")).toBe("C002 SYN Hron");
    expect(clientDisplayName(c002, undefined)).toBe("C002-syn-hron-technologie");
    expect(clientDisplayName(`${P}/Klienti/Hron`, "SYN Hron")).toBe("SYN Hron");
  });

  test("karta v chate C001 pri rozsahu `…/Klienti/C002*/*` ukáže meno klienta C002 z karty klienta", () => {
    setLocale("sk");
    const permission: PendingPermission = {
      id: "per_1", sessionID: "ses_1", permission: "external_directory", patterns: [`${P}/Klienti/C002*/*`], metadata: {},
      always: [], receivedAt: 1, protocol: "v2",
    };
    const workspace = { id: "prax", path: P, name: "Prax", displayNameResolved: "Prax" };
    // Test seam: karta číta len rozsah a klientov prehľadu; celý stav panela netreba.
    const nav = {
      scope: { anchor: workspace, members: [{ workspace, prefix: "" }] },
      data: { clients: [{ path: "Klienti/C001-syn-tatran-automatika", title: "SYN Tatran Automatika, s. r. o." }, { path: "Klienti/C002-syn-hron-technologie", title: "SYN Hron Technológie, a. s." }] },
    } as unknown as React.ComponentProps<typeof ClientNavTestProvider>["value"];
    const html = renderToStaticMarkup(<ClientNavTestProvider value={nav}><PermissionApprovalPanel permission={permission} respondPermission={() => {}} chatDirectory={`${c001}/Spisy/M001 Úhrada`} /></ClientNavTestProvider>);
    expect(html).toContain("Pristúpiť k externému priečinku?");
    // Výrazné varovanie: rámček s ikonou a rolou upozornenia, kód aj meno klienta.
    expect(html).toContain("Pozor: priečinok patrí inému klientovi (C002 SYN Hron Technológie, a. s.). Ak ho povolíte, agent uvidí jeho súbory.");
    expect(html).toMatch(/<div role="alert" data-lawoss-other-client="" class="[^"]*border-red-7\/30[^"]*bg-red-3\/40[^"]*font-semibold/);
    // Bez prehľadu (samostatné okno) karta ostane ako doteraz.
    expect(renderToStaticMarkup(<PermissionApprovalPanel permission={permission} respondPermission={() => {}} chatDirectory={c001} />)).not.toContain("data-lawoss-other-client");
  });
});
