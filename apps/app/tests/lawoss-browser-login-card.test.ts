// LAWOSS (rozhodnutie MČ 9. 11. 2026): pridanie stránky k uloženému prihláseniu ukáže kartu s prihlásením,
// pridávanou stránkou a doménou, na ktorej sa bude vypĺňať heslo. Bez „povoliť pre chat“ a bez surového JSON.
import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PendingPermission } from "../src/app/types";
import { currentLocale, setLocale, t, type Language } from "../src/i18n";
import { browserLoginCard } from "../src/lawoss/lite/browser-login-card";
import { fileOperationCard } from "../src/lawoss/lite/file-operation-card";
import { offersSessionApproval } from "../src/lawoss/lite/session-approvals";
import { PermissionApprovalPanel } from "../src/react-app/domains/session/chat/permission-approval-modal";

const initial: Language = currentLocale();
afterEach(() => setLocale(initial));

const login = { passwordId: "a8b2378c-4bf0-492a-a113-5ef80723e089", label: "Syntetický portál", origin: "https://portal.example.com",
  website: "https://kniznica.example.net/vyhladavanie", name: "Knižnica", loginOrigin: "https://signin.example.net" };
const card = (lawossBrowserLogin: Record<string, unknown>): PendingPermission => ({ id: "per_1", sessionID: "ses_1", permission: "lawoss_browser_login",
  patterns: [String(lawossBrowserLogin.loginOrigin ?? "https://kniznica.example.net")], metadata: { lawossBrowserLogin }, always: [], receivedAt: 1, protocol: "v2" });
const buttons = (html: string) => Array.from(html.matchAll(/<button\b[\s\S]*?<\/button>/g)).map((match) => match[0].replace(/<[^>]*>/g, "").trim());

describe("karta uloženého prihlásenia", () => {
  test("po slovensky: prihlásenie, stránka a doména, kde sa bude vypĺňať heslo; len Zamietnuť a Povoliť raz", () => {
    setLocale("sk");
    const html = renderToStaticMarkup(React.createElement(PermissionApprovalPanel, { permission: card(login), respondPermission: () => {} }));
    expect(html).toContain("Vypĺňať uložené heslo na ďalšej stránke?");
    expect(html).toContain("Prihlásenie: Syntetický portál (https://portal.example.com)");
    expect(html).toContain("Pridávaná stránka: Knižnica (https://kniznica.example.net/vyhladavanie)");
    expect(html).toContain("Heslo sa bude vypĺňať aj na: https://signin.example.net");
    for (const raw of ["lawossBrowserLogin", "passwordId", "lawoss_browser_login"]) expect(html.includes(raw) ? raw : null).toBeNull();
    expect(buttons(html)).toEqual([t("session.deny"), t("session.allow_once")]);
    expect(offersSessionApproval(card(login), null)).toBe(false);
  });

  test("len stránka na otváranie povie, že sa na ňu heslo nevypĺňa", () => {
    setLocale("sk");
    const presented = browserLoginCard({ lawossBrowserLogin: { ...login, name: null, loginOrigin: null } });
    expect(presented?.title).toBe("Pridať stránku k uloženému prihláseniu?");
    expect(presented?.scopeValue.split("\n")).toEqual(["Prihlásenie: Syntetický portál (https://portal.example.com)",
      "Pridávaná stránka: https://kniznica.example.net/vyhladavanie", "Heslo sa na túto stránku nevypĺňa."]);
  });

  test("texty v češtine, angličtine a nemčine", () => {
    const expected: Array<[Language, string, string]> = [
      ["cs", "Vyplňovat uložené heslo na další stránce?", "Heslo se bude vyplňovat i na: https://signin.example.net"],
      ["en", "Fill a saved password on another website?", "The password will also be filled on: https://signin.example.net"],
      ["de", "Gespeichertes Passwort auf einer weiteren Website eintragen?", "Das Passwort wird auch eingetragen auf: https://signin.example.net"],
    ];
    for (const [language, title, line] of expected) {
      setLocale(language);
      const presented = fileOperationCard({ lawossBrowserLogin: login });
      expect([language, presented?.title]).toEqual([language, title]);
      expect(presented?.scopeValue).toContain(line);
    }
  });

  test("neúplné údaje nie sú karta prihlásenia", () => {
    expect(browserLoginCard({ lawossBrowserLogin: { ...login, website: "" } })).toBeNull();
    expect(browserLoginCard({})).toBeNull();
  });
});
