/** @jsxImportSource react */
// N-A8-3 (regresia 30. 10. 2026): „Podrobnosti“ na karte „Upraviť súbory?“ a „Pristúpiť k externému priečinku?“ ukazovali
// surový JSON (`{ "filepath": …, "diff": … }`, `{ "filepath": …, "parentDir": … }`). Teraz súbor voči priečinku klienta,
// pridané/odobraté riadky a pri externom priečinku priečinok a súbor s popisom. Iné otázky ostanú pri JSON.
// Syntetická prax /Users/advokat/Prax.
import { afterEach, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { currentLocale, setLocale } from "../src/i18n";
import type { PendingPermission } from "../src/app/types";
import { ClientNavTestProvider } from "../src/lawoss/lite/client-nav";
import { changeLines, clientRelativePath, permissionDetails } from "../src/lawoss/lite/permission-details";
import { PermissionApprovalPanel } from "../src/react-app/domains/session/chat/permission-approval-modal";

const P = "/Users/advokat/Prax";
const c001 = `${P}/Klienti/C001-syn-tatran-automatika`;
const file = `${c001}/Spisy/M001 Úhrada/03_Drafty/01-zmluva.md`;
const original = currentLocale();
afterEach(() => setLocale(original));

// Zjednotený diff, aký engine dáva pri úprave súboru.
const diff = [
  `Index: ${file}`, "===================================================================", `--- ${file}`, `+++ ${file}`,
  "@@ -1,3 +1,3 @@", " # Zmluva o dielo", "-Cena diela je 1 000 EUR.", "+Cena diela je 1 200 EUR.", " Zhotoviteľ: SYN Tatran", "\\ No newline at end of file",
].join("\n");
const card = (permission: string, metadata: Record<string, unknown>): PendingPermission => ({
  id: `per_${permission}`, sessionID: "ses_1", permission, patterns: [permission === "edit" ? file : `${P}/Klienti/Iny/*`], metadata, always: [], receivedAt: 1, protocol: "v2",
});
const workspace = { id: "prax", path: P, name: "Prax", displayNameResolved: "Prax" };
// Test seam: karta číta len rozsah a klientov prehľadu; celý stav panela netreba.
const nav = {
  scope: { anchor: workspace, members: [{ workspace, prefix: "" }] },
  data: { clients: [{ path: "Klienti/C001-syn-tatran-automatika", title: "SYN Tatran Automatika, s. r. o." }] },
} as unknown as React.ComponentProps<typeof ClientNavTestProvider>["value"];
const details = (html: string): string => html.slice(html.indexOf("data-lawoss-file-details"));

test("riadky zmeny bez hlavičiek a kontextu; cesta voči klientovi", () => {
  expect(changeLines(diff)).toEqual(["- Cena diela je 1 000 EUR.", "+ Cena diela je 1 200 EUR."]);
  // Riadky z brány editora („- starý“, „+ nový“) ostanú.
  expect(changeLines("- starý text\n+ nový text")).toEqual(["- starý text", "+ nový text"]);
  expect(changeLines(Array.from({ length: 205 }, (_, index) => `+riadok ${index}`).join("\n"))).toHaveLength(201);
  expect(clientRelativePath(file, c001)).toBe("Spisy/M001 Úhrada/03_Drafty/01-zmluva.md");
  expect(clientRelativePath(file, `${P}/Klienti/C002`)).toBe(file);
  expect(clientRelativePath(file, null)).toBe(file);
  expect(permissionDetails(card("bash", { command: "ls" }))).toBeNull();
});

test("karta úpravy v chate spisu: súbor voči klientovi a pridané/odobraté riadky, nie JSON", () => {
  setLocale("sk");
  const permission = card("edit", { filepath: file, diff });
  const html = renderToStaticMarkup(<ClientNavTestProvider value={nav}><PermissionApprovalPanel permission={permission} respondPermission={() => {}} chatDirectory={`${c001}/Spisy/M001 Úhrada`} /></ClientNavTestProvider>);
  const shown = details(html);
  expect(shown).toContain("Súbor: Spisy/M001 Úhrada/03_Drafty/01-zmluva.md");
  expect(shown).toContain("Navrhnutá zmena (+ pridané, - odobraté):");
  expect(shown).toContain("- Cena diela je 1 000 EUR.");
  expect(shown).toContain("+ Cena diela je 1 200 EUR.");
  for (const raw of ["&quot;filepath&quot;", "&quot;diff&quot;", "{", "@@", "Index:"]) expect(shown).not.toContain(raw);
  // Bez priečinka chatu (dialóg, samostatné okno) celá cesta, tiež bez JSON.
  expect(permissionDetails(permission)?.lines[0]).toBe(`Súbor: ${file}`);
});

test("karta externého priečinka: priečinok a súbor s popisom, nie JSON", () => {
  setLocale("sk");
  const permission = card("external_directory", { filepath: `${P}/Klienti/Iny/zmluva.pdf`, parentDir: `${P}/Klienti/Iny` });
  const shown = details(renderToStaticMarkup(<PermissionApprovalPanel permission={permission} respondPermission={() => {}} chatDirectory={c001} />));
  expect(shown).toContain(`Priečinok mimo tohto klienta: ${P}/Klienti/Iny`);
  expect(shown).toContain(`Súbor, ktorý chce agent otvoriť: ${P}/Klienti/Iny/zmluva.pdf`);
  for (const raw of ["&quot;filepath&quot;", "&quot;parentDir&quot;", "{"]) expect(shown).not.toContain(raw);
});

test("neznámy typ otázky ostane pri doterajšom zobrazení", () => {
  setLocale("sk");
  const html = renderToStaticMarkup(<PermissionApprovalPanel permission={card("webfetch", { url: "https://example.test" })} respondPermission={() => {}} />);
  expect(html).not.toContain("data-lawoss-file-details");
  expect(html).toContain("&quot;url&quot;");
});
