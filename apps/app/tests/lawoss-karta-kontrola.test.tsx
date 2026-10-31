/** @jsxImportSource react */
// Rozhodnutie MČ 31. 10. 2026 (k N-A8-3): blok „Kontrola“ v dialógu povolenia ukazoval surový diff enginu s hlavičkami
// `Index:`, `---`, `+++`, `@@`. Teraz súbor voči priečinku klienta a pridané/odobraté riadky s farbou a značkou,
// tou istou funkciou ako Podrobnosti (`changeLines`). Syntetická prax /Users/advokat/Prax.
//
// Dialóg sa vykresľuje cez portál, ktorý pri renderToStaticMarkup nevykreslí nič. Test preto počas behu nahradí
// `@/components/ui/alert-dialog` obyčajnými prvkami; obsah dialógu je ten skutočný. Po teste sa modul vráti.
import { afterAll, afterEach, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { currentLocale, setLocale } from "../src/i18n";
import type { PendingPermission } from "../src/app/types";
import { ClientNavTestProvider } from "../src/lawoss/lite/client-nav";
import { readableReviewRows } from "../src/lawoss/lite/permission-details";

const alertDialogPath = "../src/components/ui/alert-dialog";
const alertDialog = { ...(await import(alertDialogPath)) };
const Plain = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
mock.module(alertDialogPath, () => ({
  ...alertDialog, AlertDialog: Plain, AlertDialogContent: Plain, AlertDialogHeader: Plain, AlertDialogTitle: Plain,
  AlertDialogDescription: Plain, AlertDialogFooter: Plain, AlertDialogAction: Plain,
}));
afterAll(() => { mock.module(alertDialogPath, () => alertDialog); });
const { PermissionApprovalModal } = await import("../src/react-app/domains/session/chat/permission-approval-modal");

const P = "/Users/advokat/Prax";
const c001 = `${P}/Klienti/C001-syn-tatran-automatika`;
const file = `${c001}/Spisy/M001 Úhrada/03_Drafty/01-zmluva.md`;
const original = currentLocale();
afterEach(() => setLocale(original));

const diff = [
  `Index: ${file}`, "===================================================================", `--- ${file}`, `+++ ${file}`,
  "@@ -1,3 +1,3 @@", " # Zmluva o dielo", "-Cena diela je 1 000 EUR.", "+Cena diela je 1 200 EUR.", " Zhotoviteľ: SYN Tatran",
].join("\n");
const edit = (metadata: Record<string, unknown>): PendingPermission => ({
  id: "per_edit", sessionID: "ses_1", permission: "edit", patterns: [file], metadata, always: [], receivedAt: 1, protocol: "v2",
});
const workspace = { id: "prax", path: P, name: "Prax", displayNameResolved: "Prax" };
const nav = {
  scope: { anchor: workspace, members: [{ workspace, prefix: "" }] },
  data: { clients: [{ path: "Klienti/C001-syn-tatran-automatika", title: "SYN Tatran Automatika, s. r. o." }] },
} as unknown as React.ComponentProps<typeof ClientNavTestProvider>["value"];
/** Blok „Kontrola“: od jeho nadpisu po Podrobnosti (tie testuje lawoss-karta-podrobnosti). */
const review = (html: string): string => {
  const start = html.indexOf("Kontrola");
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("Podrobnosti", start));
};

test("Kontrola v dialógu: súbor voči klientovi a zmena s farbou, bez hlavičiek diffu", () => {
  setLocale("sk");
  const html = renderToStaticMarkup(<ClientNavTestProvider value={nav}>
    <PermissionApprovalModal permission={edit({ filepath: file, diff })} respondPermission={() => {}} chatDirectory={`${c001}/Spisy/M001 Úhrada`} />
  </ClientNavTestProvider>);
  const shown = review(html);
  expect(shown).toContain("Spisy/M001 Úhrada/03_Drafty/01-zmluva.md");
  expect(shown).not.toContain(c001);
  expect(shown).toContain("Navrhnutá zmena (+ pridané, - odobraté)");
  expect(shown).toMatch(/data-change="removed">- Cena diela je 1 000 EUR\.</);
  expect(shown).toMatch(/data-change="added">\+ Cena diela je 1 200 EUR\.</);
  expect(shown).toMatch(/class="[^"]*text-red-11[^"]*line-through[^"]*" data-change="removed"/);
  expect(shown).toMatch(/class="[^"]*text-green-11[^"]*" data-change="added"/);
  for (const raw of ["@@", "Index:", "+++", "---", "====", "Zhotoviteľ"]) expect(shown.includes(raw) ? raw : null).toBeNull();
});

test("Kontrola: limit riadkov, zmena bez riadkov a ostatné riadky bez zmeny", () => {
  setLocale("sk");
  const long = Array.from({ length: 230 }, (_, index) => `+riadok ${index}`).join("\n");
  const rows = readableReviewRows([
    { label: "Súbor", value: file },
    { label: "Navrhnuté zmeny", value: long, multiline: true },
    { label: "Príkaz", value: "ls" },
  ], c001);
  expect(rows[0]).toEqual({ label: "Súbor", value: "Spisy/M001 Úhrada/03_Drafty/01-zmluva.md" });
  const change = renderToStaticMarkup(<>{rows[1]!.value}</>);
  expect(change.match(/data-change="added"/g)).toHaveLength(200);
  expect(change).toContain('data-change="more">… a ďalších 30 riadkov<');
  expect(rows[1]!.multiline).toBe(true);
  expect(rows[2]).toEqual({ label: "Príkaz", value: "ls" });
  // Diff len s hlavičkami: veta namiesto prázdneho bloku.
  expect(readableReviewRows([{ label: "Navrhnuté zmeny", value: `--- ${file}\n+++ ${file}` }])[0]!.value).toBe("Zmenu sa nedá vopred zobraziť.");
});
