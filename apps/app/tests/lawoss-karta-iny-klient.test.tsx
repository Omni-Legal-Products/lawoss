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
import { otherClientFolder, otherClientFolderText, type CardClient } from "../src/lawoss/lite/other-client-folder";
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

  test("veta karty po slovensky, česky, anglicky aj nemecky", () => {
    const expected: Record<Language, string> = {
      sk: "Priečinok patrí inému klientovi: SYN Hron Technológie, a. s. Agent by videl jeho súbory.",
      cs: "Složka patří jinému klientovi: SYN Hron Technológie, a. s. Agent by viděl jeho soubory.",
      en: "This folder belongs to another client: SYN Hron Technológie, a. s. The agent would see that client's files.",
      de: "Dieser Ordner gehört einem anderen Mandanten: SYN Hron Technológie, a. s. Der Agent würde dessen Dateien sehen.",
    } as Record<Language, string>;
    for (const [locale, text] of Object.entries(expected)) {
      setLocale(locale as Language);
      expect(otherClientFolderText({ kind: "inside", name: "SYN Hron Technológie, a. s." })).toBe(text);
    }
    setLocale("sk");
    expect(otherClientFolderText({ kind: "contains", names: ["A", "B", "C", "D", "E"] })).toBe("Priečinok obsahuje priečinky iných klientov: A, B, C +2. Agent by videl ich súbory.");
    expect(otherClientFolderText({ kind: "uncertain" })).toBe("Rozsah obsahuje znaky, podľa ktorých sa nedá overiť, či nesiaha do priečinka iného klienta. Pred povolením ho skontrolujte.");
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
    expect(html).toContain("Priečinok patrí inému klientovi: SYN Hron Technológie, a. s. Agent by videl jeho súbory.");
    // Bez prehľadu (samostatné okno) karta ostane ako doteraz.
    expect(renderToStaticMarkup(<PermissionApprovalPanel permission={permission} respondPermission={() => {}} chatDirectory={c001} />)).not.toContain("data-lawoss-other-client");
  });
});
