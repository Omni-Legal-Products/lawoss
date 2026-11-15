// LAWOSS #423: karta `lawoss_new_client` ukáže všetko, čo sa zapíše (priečinok, meno, typ, IČO, poznámku), varuje,
// že klient vznikne mimo klienta chatu, a nemá „povoliť pre chat“ (pýta sa vždy, aj v YOLO).
import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PendingPermission } from "../src/app/types";
import { currentLocale, setLocale, t, type Language } from "../src/i18n";
import { fileOperationCard } from "../src/lawoss/lite/file-operation-card";
import { newClientCard } from "../src/lawoss/lite/new-client-card";
import { coveredBySessionApproval, offersSessionApproval, rememberSessionApproval } from "../src/lawoss/lite/session-approvals";
import { PermissionApprovalPanel } from "../src/react-app/domains/session/chat/permission-approval-modal";

const initial: Language = currentLocale();
afterEach(() => setLocale(initial));

const TARGET = "/synthetic/Kancelaria/Klienti/Novák s. r. o";
const client = { target: TARGET, name: "Novák s. r. o.", clientType: "po", ico: "12345678", note: "Dodávateľ stavebnín" };
const card = (lawossNewClient: Record<string, unknown>): PendingPermission => ({ id: "per_nc", sessionID: "ses_nc", permission: "lawoss_client_create",
  patterns: [TARGET], metadata: { lawossNewClient }, always: [], receivedAt: 1, protocol: "v2" });
const buttons = (html: string) => Array.from(html.matchAll(/<button\b[\s\S]*?<\/button>/g)).map((match) => match[0].replace(/<[^>]*>/g, "").trim());

describe("karta nového klienta", () => {
  test("po slovensky: priečinok, meno, typ, IČO, poznámka a varovanie; len Zamietnuť a Povoliť raz", () => {
    setLocale("sk");
    const html = renderToStaticMarkup(React.createElement(PermissionApprovalPanel, { permission: card(client), respondPermission: () => {} }));
    expect(html).toContain("Založiť nového klienta kancelárie?");
    expect(html).toContain("Zapisuje sa mimo tohto klienta");
    for (const line of [`Priečinok: ${TARGET}`, "Klient: Novák s. r. o.", "Typ: právnická osoba", "IČO: 12345678", "Poznámka na karte klienta: Dodávateľ stavebnín"])
      expect(html).toContain(line);
    for (const raw of ["lawossNewClient", "lawoss_client_create", "clientType"]) expect(html.includes(raw) ? raw : null).toBeNull();
    expect(buttons(html)).toEqual([t("session.deny"), t("session.allow_once")]);
  });

  test("povolenie pre chat ju nepokryje ani po schválení inej karty", () => {
    expect(offersSessionApproval(card(client), null)).toBe(false);
    rememberSessionApproval({ ...card(client), permission: "lawoss_file_change", metadata: { lawossFiles: [{ operation: "create_folder", kind: "folder", to: "/x" }] } });
    expect(coveredBySessionApproval(card(client), ["ses_nc"])).toBe(false);
  });

  test("bez IČO a poznámky ich neukáže; dlhá poznámka sa skráti; typy v štyroch jazykoch", () => {
    setLocale("sk");
    expect(newClientCard({ lawossNewClient: { target: TARGET, name: "Ján Novák", clientType: "fo" } })?.scopeValue.split("\n"))
      .toEqual([`Priečinok: ${TARGET}`, "Klient: Ján Novák", "Typ: fyzická osoba"]);
    const long = newClientCard({ lawossNewClient: { ...client, note: "a".repeat(600) } })?.scopeValue ?? "";
    expect(long).toContain(`${"a".repeat(280)}…`);
    expect(long).not.toContain("a".repeat(281));
    const expected: Array<[Language, string, string]> = [
      ["sk", "Založiť nového klienta kancelárie?", "Typ: fyzická osoba podnikateľ"],
      ["cs", "Založit nového klienta kanceláře?", "Typ: fyzická osoba podnikatel"],
      ["en", "Create a new client of the office?", "Type: sole trader"],
      ["de", "Neuen Mandanten der Kanzlei anlegen?", "Art: Einzelunternehmer"],
    ];
    for (const [language, title, line] of expected) {
      setLocale(language);
      const presented = fileOperationCard({ lawossNewClient: { ...client, clientType: "fo-podnikatel" } });
      expect([language, presented?.title]).toEqual([language, title]);
      expect(presented?.scopeValue).toContain(line);
    }
  });

  test("neúplné údaje alebo neznámy typ nie sú karta nového klienta", () => {
    expect(newClientCard({ lawossNewClient: { ...client, clientType: undefined } })).toBeNull();
    expect(newClientCard({ lawossNewClient: { ...client, clientType: "firma" } })).toBeNull();
    expect(newClientCard({ lawossNewClient: { ...client, target: "" } })).toBeNull();
    expect(newClientCard({})).toBeNull();
  });
});
