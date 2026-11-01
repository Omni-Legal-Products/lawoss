/** @jsxImportSource react */
// N-A7-14 (rozhodnutie MČ 30. 10. 2026): karta „Pristúpiť k externému priečinku?“ pre cestu, ktorá neexistuje, to povie.
// Existenciu overuje desktop (`lawossFolderState`); tu ho nahrádza syntetická funkcia. Syntetická prax /Users/advokat/Prax.
import { afterEach, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { currentLocale, setLocale, type Language } from "../src/i18n";
import type { PendingPermission } from "../src/app/types";
import { checkedFolders, loadMissingFolder, type FolderState } from "../src/lawoss/lite/missing-folder";
import { PermissionApprovalPanel } from "../src/react-app/domains/session/chat/permission-approval-modal";

const P = "/Users/advokat/Prax/Klienti";
const original = currentLocale();
afterEach(() => setLocale(original));

const card = (id: string, patterns: string[], permission = "external_directory"): PendingPermission => ({
  id, sessionID: "ses_1", permission, patterns, metadata: {}, always: [], receivedAt: 1, protocol: "v2",
});
const stat = (existing: string[]) => async (path: string): Promise<FolderState> => existing.includes(path) ? "dir" : "missing";

test("overujú sa len obyčajné absolútne cesty z rozsahu `<priečinok>/*`", () => {
  expect(checkedFolders([`${P}/C002/*`, `${P}/C002/*`, `${P}/C00*/*`, `${P}/{A,B}/*`, "Klienti/C002/*", `${P}/C002`, "C:\\Prax\\C002\\*"]))
    .toEqual([`${P}/C002`, "C:\\Prax\\C002"]);
});

test("neexistujúci priečinok: karta to povie; existujúci, vzor a iná karta nie", async () => {
  setLocale("sk");
  const missing = card("per_missing", [`${P}/C002/*`]);
  expect(await loadMissingFolder(missing, stat([]))).toBe(true);
  const html = renderToStaticMarkup(<PermissionApprovalPanel permission={missing} respondPermission={() => {}} chatDirectory={`${P}/C001-syn-tatran`} />);
  expect(html).toContain("Pristúpiť k externému priečinku?");
  expect(html).toContain("Tento priečinok v počítači neexistuje. Nie je v ňom čo otvoriť, žiadosť môžete zamietnuť.");

  for (const permission of [card("per_dir", [`${P}/C001-syn-tatran/*`]), card("per_glob", [`${P}/C00*/*`]), card("per_edit", [`${P}/C002/*`], "edit")]) {
    expect(await loadMissingFolder(permission, stat([`${P}/C001-syn-tatran`]))).toBe(false);
    expect(renderToStaticMarkup(<PermissionApprovalPanel permission={permission} respondPermission={() => {}} />)).not.toContain("data-lawoss-missing-folder");
  }
  // Bez desktopu (prehliadač) sa nič neoveruje.
  expect(await loadMissingFolder(card("per_web", [`${P}/C009/*`]))).toBe(false);
});

test("veta karty vo všetkých jazykoch", async () => {
  const expected: Record<string, string> = {
    sk: "Tento priečinok v počítači neexistuje.",
    cs: "Tato složka v počítači neexistuje.",
    en: "This folder does not exist on this computer.",
    de: "Dieser Ordner existiert auf diesem Computer nicht.",
  };
  const permission = card("per_lang", [`${P}/C002/*`]);
  await loadMissingFolder(permission, stat([]));
  for (const [locale, text] of Object.entries(expected)) {
    setLocale(locale as Language);
    expect(renderToStaticMarkup(<PermissionApprovalPanel permission={permission} respondPermission={() => {}} />)).toContain(text);
  }
});
