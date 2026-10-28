/** @jsxImportSource react */
// N-A7-14 (test E2, 28. 10. 2026): karta „Pristúpiť k externému priečinku?“ v chate klienta C001 pri rozsahu
// `…/Klienti/C002*/*` povie, že priečinok patrí inému klientovi, s jeho menom. Syntetická prax /Users/advokat/Prax.
import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { currentLocale, setLocale, type Language } from "../src/i18n";
import type { PendingPermission } from "../src/app/types";
import { ClientNavTestProvider } from "../src/lawoss/lite/client-nav";
import { otherClientFolder, otherClientFolderText } from "../src/lawoss/lite/other-client-folder";
import { PermissionApprovalPanel } from "../src/react-app/domains/session/chat/permission-approval-modal";

const practice = "/Users/advokat/Prax";
const c001 = `${practice}/Klienti/C001-syn-tatran-automatika`;
const c002 = `${practice}/Klienti/C002-syn-hron-technologie`;
const workspaces = [
  { id: "prax", path: practice, displayNameResolved: "Prax" },
  { id: "c001", path: c001, displayNameResolved: "SYN Tatran Automatika, s. r. o." },
  { id: "c002", path: c002, displayNameResolved: "SYN Hron Technológie, a. s." },
  { id: "c003", path: `${practice}/Klienti/C003-syn-orava`, displayNameResolved: "SYN Orava, s. r. o." },
  { id: "wiki", path: `${practice}/Wiki`, displayNameResolved: "Wiki", preset: "wiki" },
];

const original = currentLocale();
afterEach(() => setLocale(original));

describe("priečinok iného klienta", () => {
  test("rozsah v inom klientovi, vzor `C002*` hľadania aj z chatu prípadu: meno toho klienta", () => {
    for (const chat of [c001, `${c001}/Spisy/M001 Úhrada`]) {
      for (const pattern of [`${practice}/Klienti/C002*/*`, `${c002}/*`, `${c002}/Spisy/M004/*`, `${practice}/Klienti/c002-SYN-hron*/*`])
        expect(otherClientFolder([pattern], chat, workspaces)).toEqual({ kind: "inside", name: "SYN Hron Technológie, a. s." });
    }
  });

  test("priečinok s inými klientmi: ich mená; vlastný klient, pripojený priečinok mimo praxe a iné oprávnenia nič", () => {
    expect(otherClientFolder([`${practice}/Klienti/*`], c001, workspaces)).toEqual({ kind: "contains", names: ["SYN Hron Technológie, a. s.", "SYN Orava, s. r. o."] });
    for (const patterns of [[`${c001}/Spisy/*`], ["/Users/advokat/Zdielane/Vzory/*"], [`${practice}/Wiki/*`], [`${practice}/Klienti/C001*/*`], [c002]])
      expect(otherClientFolder(patterns, c001, workspaces)).toBeNull();
    // Chat kontajnera praxe ani neznámeho priečinka sa nerieši.
    expect(otherClientFolder([`${c002}/*`], practice, workspaces)).toBeNull();
    expect(otherClientFolder([`${c002}/*`], "/Users/advokat/Iny", workspaces)).toBeNull();
    expect(otherClientFolder([`${c002}/*`], "", workspaces)).toBeNull();
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
  });

  test("karta v chate C001 pri rozsahu `…/Klienti/C002*/*` ukáže meno klienta C002", () => {
    setLocale("sk");
    const permission: PendingPermission = {
      id: "per_1", sessionID: "ses_1", permission: "external_directory", patterns: [`${practice}/Klienti/C002*/*`], metadata: {},
      always: [], receivedAt: 1, protocol: "v2",
    };
    // Test seam: karta číta len `connection.workspaces`; celý stav panela netreba.
    const nav = { connection: { workspaces } } as unknown as React.ComponentProps<typeof ClientNavTestProvider>["value"];
    const html = renderToStaticMarkup(<ClientNavTestProvider value={nav}><PermissionApprovalPanel permission={permission} respondPermission={() => {}} chatDirectory={c001} /></ClientNavTestProvider>);
    expect(html).toContain("Pristúpiť k externému priečinku?");
    expect(html).toContain("Priečinok patrí inému klientovi: SYN Hron Technológie, a. s. Agent by videl jeho súbory.");
    // Bez klientov z panela (samostatné okno) karta ostane ako doteraz.
    expect(renderToStaticMarkup(<PermissionApprovalPanel permission={permission} respondPermission={() => {}} chatDirectory={c001} />)).not.toContain("data-lawoss-other-client");
  });
});
