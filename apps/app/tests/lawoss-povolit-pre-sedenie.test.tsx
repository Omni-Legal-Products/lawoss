/** @jsxImportSource react */
// MČ 2. 11. 2026: karta úprav súborov a priečinka mimo chatu ponúka „Povoliť do konca konverzácie“.
// Appka si povolenie drží len v pamäti pre chat, ktorý sa pýtal; varovanie o inom klientovi sa pýta vždy.
import { afterEach, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { currentLocale, setLocale } from "../src/i18n";
import type { PendingPermission } from "../src/app/types";
import { clearSessionApprovals, coveredBySessionApproval, offersSessionApproval, rememberSessionApproval } from "../src/lawoss/lite/session-approvals";
import { PermissionApprovalPanel } from "../src/react-app/domains/session/chat/permission-approval-modal";

const P = "/Users/advokat/Prax/Klienti";
const original = currentLocale();
afterEach(() => { setLocale(original); clearSessionApprovals(); });

const card = (id: string, permission: string, patterns: string[], sessionID = "ses_1", protocol: PendingPermission["protocol"] = "v2"): PendingPermission => ({
  id, sessionID, permission, patterns, metadata: {}, always: [], receivedAt: 1, protocol,
});

test("tlačidlo pri úpravách a priečinku mimo chatu, nie pri varovaní o inom klientovi ani pri karte príkazu", () => {
  expect(offersSessionApproval(card("a", "edit", [`${P}/C001/zmluva.docx`]), null)).toBe(true);
  expect(offersSessionApproval(card("b", "lawoss_file_change", ["*"]), null)).toBe(true);
  expect(offersSessionApproval(card("c", "external_directory", ["/Volumes/NAS/Spisy/*"]), null)).toBe(true);
  expect(offersSessionApproval(card("d", "external_directory", [`${P}/C002/*`]), "Priečinok patrí inému klientovi")).toBe(false);
  expect(offersSessionApproval(card("e", "bash", ["ls"]), null)).toBe(false);
  expect(offersSessionApproval(card("f", "edit", ["x"], "ses_1", "host"), null)).toBe(false);
  // Zápis do pamäte prípadu schvaľuje advokát vždy zvlášť.
  const memory = { ...card("g", "lawoss_file_change", ["Spisy/M004-SYN/memory/M004-MAT.md"]), metadata: { lawossMemory: { target: "Spisy/M004-SYN/memory/M004-MAT.md" } } };
  expect(offersSessionApproval(memory, null)).toBe(false);
  rememberSessionApproval(card("h", "edit", ["y"]));
  expect(coveredBySessionApproval(memory, ["ses_1"])).toBe(false);
});

test("povolené úpravy platia pre celý chat, priečinok len pre ten istý rozsah, iný chat sa pýta", () => {
  rememberSessionApproval(card("a", "edit", [`${P}/C001/zmluva.docx`]));
  expect(coveredBySessionApproval(card("a2", "edit", [`${P}/C001/iny.docx`]), ["ses_1"])).toBe(true);
  expect(coveredBySessionApproval(card("a3", "lawoss_file_change", ["*"]), ["ses_1"])).toBe(true);
  expect(coveredBySessionApproval(card("a4", "edit", ["x"], "ses_2"), ["ses_2"])).toBe(false);
  expect(coveredBySessionApproval(card("a5", "external_directory", ["/Volumes/NAS/*"]), ["ses_1"])).toBe(false);

  rememberSessionApproval(card("b", "external_directory", ["/Volumes/NAS/Spisy/*"]));
  expect(coveredBySessionApproval(card("b2", "external_directory", ["/Volumes/NAS/Spisy/*"]), ["ses_1"])).toBe(true);
  expect(coveredBySessionApproval(card("b3", "external_directory", ["/Volumes/NAS/Iné/*"]), ["ses_1"])).toBe(false);
  // Žiadosť podagenta pokryje povolenie otvoreného chatu.
  expect(coveredBySessionApproval(card("b4", "edit", ["y"], "ses_sub"), ["ses_sub", "ses_1"])).toBe(true);
  expect(coveredBySessionApproval(card("b5", "bash", ["ls"]), ["ses_1"])).toBe(false);
});

test("karta ukáže tlačidlo pri úprave súboru, nie pri karte, ktorá si „always“ pamätá sama", () => {
  setLocale("sk");
  const edit = renderToStaticMarkup(<PermissionApprovalPanel permission={card("e1", "edit", [`${P}/C001/zmluva.docx`])} respondPermission={() => {}} />);
  expect(edit).toContain("data-lawoss-session-approval");
  expect(edit).toContain("Povoliť do konca konverzácie");
  const webfetch = renderToStaticMarkup(<PermissionApprovalPanel permission={{ ...card("w1", "webfetch", ["https://www.slov-lex.sk/*"]), always: ["https://www.slov-lex.sk/*"] }} respondPermission={() => {}} />);
  expect(webfetch).not.toContain("data-lawoss-session-approval");
});
