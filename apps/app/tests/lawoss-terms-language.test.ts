import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import type { PendingPermission } from "../src/app/types";
import en from "../src/i18n/locales/en";
import de from "../src/i18n/locales/de";
import sk from "../src/i18n/locales/sk";
import cs from "../src/i18n/locales/cs";
import { currentLocale, setLocale, t, type Language } from "../src/i18n";
import { termsDe, termsEn } from "../src/lawoss/i18n/terms";
import { shellCs, shellSk } from "../src/lawoss/i18n/shell";
import { mattersCs, mattersSk } from "../src/lawoss/i18n/matters";
import { setupCs, setupSk } from "../src/lawoss/i18n/setup";
import { integrationsCs, integrationsSk } from "../src/lawoss/i18n/integrations";
import { documentProfileCopy } from "../src/react-app/domains/session/panel/document-processing";
import { AI_BOUNDARIES_STORED_MESSAGE, aiBoundariesRefusal } from "../src/lawoss/domains/ai/boundaries-refusal";
import { sendErrorFromThrown, sendErrorText } from "../src/lawoss/domains/ai/send-error";
import { PermissionApprovalPanel } from "../src/react-app/domains/session/chat/permission-approval-modal";

const initial: Language = currentLocale();
afterEach(() => setLocale(initial));

const placeholders = (value: string): string[] => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe("EN a DE: Client / Case / Chats a Mandant / Fall / Chats (N-11)", () => {
  test("slovník nadpisuje len existujúce kľúče a zachová zástupné znaky", () => {
    for (const [terms, base] of [[termsEn, en], [termsDe, de]] as const) {
      const source: Record<string, string> = base;
      for (const [key, value] of Object.entries(terms)) {
        expect(source[key]).toBeDefined();
        expect(placeholders(value)).toEqual(placeholders(source[key]!));
      }
    }
  });

  test("hlavné popisky: Projects/Sessions/Home/Evaluations sa vo výdaji už neobjavia", () => {
    setLocale("en");
    expect(t("projects.plural")).toBe("Clients");
    expect(t("projects.create")).toBe("Create client");
    expect(t("projects.sessions")).toBe("Chats");
    expect(t("sidebar.recent_sessions")).toBe("Recent Chats");
    expect(t("project_browser.new_session")).toBe("New chat");
    expect(t("workspace.overview")).toBe("Overview");
    setLocale("de");
    expect(t("projects.plural")).toBe("Mandanten");
    expect(t("projects.create")).toBe("Mandanten erstellen");
    expect(t("projects.sessions")).toBe("Chats");
    expect(t("sidebar.recent_sessions")).toBe("Letzte Chats");
    expect(t("project_browser.new_session")).toBe("Neuer Chat");
    expect(t("session.default_title")).toBe("Neuer Chat");
    expect(t("workspace.overview")).toBe("Übersicht");
    expect(t("sidebar.evals")).toBe("Auswertungen");
  });

  test("prípad je Case / Fall v LAWOSS slovníkoch, Aktenzeichen ostáva", () => {
    setLocale("en");
    expect(t("lawoss.matters.mattersTitle")).toBe("Cases");
    expect(t("lawoss.lite.new_matter")).toBe("New case");
    setLocale("de");
    expect(t("lawoss.matters.mattersTitle")).toBe("Fälle");
    expect(t("lawoss.lite.new_matter")).toBe("Neuer Fall");
    expect(t("lawoss.matters.field.reference")).toBe("Aktenzeichen");
    for (const value of Object.entries(de).filter(([key]) => key.startsWith("lawoss.") && key !== "lawoss.alpha.notice" && !key.startsWith("lawoss.setup.welcome.")).map(([, v]) => v)) {
      expect(String(value).replace(/Aktenzeichen/g, "")).not.toMatch(/\bAkten?\b|Angelegenheit/);
    }
  });

  test("profil prípadu v dokumentoch používa Case / Fall", () => {
    expect(documentProfileCopy.en.label).toContain("case");
    expect(documentProfileCopy.de.label).toBe("Geprüftes Profil und Fall");
  });
});

describe("SK a CS: Prípad / Případ namiesto spisu (N-3, F1, N-6)", () => {
  // Texty onboardingu (alfa upozornenie, analytika, „Toto je“) mení úloha C1.
  const LEFT_TO_C1 = new Set(["lawoss.alpha.notice", "lawoss.setup.welcome.analyticsDesc", "lawoss.setup.wizard.clientRootHint", "projects.schema.matter_number"]);
  const OLD = /(?<![-\p{L}/])[Ss]pis(y|u|e|ov|om|och|mi|ů|ům|ech|em)?(?![\p{L}])/u;
  test("slovníky nehovoria o spise vo význame prípadu", () => {
    for (const dict of [shellSk, shellCs, mattersSk, mattersCs, setupSk, setupCs, integrationsSk, integrationsCs]) {
      const hits = Object.entries(dict as Record<string, string>)
        .filter(([key, value]) => !LEFT_TO_C1.has(key) && OLD.test(String(value)));
      expect(hits).toEqual([]);
    }
    for (const dict of [sk, cs] as Record<string, string>[]) {
      const hits = Object.entries(dict).filter(([key, value]) => !LEFT_TO_C1.has(key) && OLD.test(value));
      expect(hits).toEqual([]);
    }
  });

  test("konkrétne texty z akceptácie", () => {
    expect(sk["lawoss.ai_boundaries.description"]).toContain("obsah prípadov");
    expect(cs["lawoss.ai_boundaries.description"]).toContain("obsah případů");
    expect(sk["lawoss.lite.project_matters_empty"]).toBe("Zatiaľ bez prípadov.");
    expect(cs["lawoss.lite.project_matters_empty"]).toBe("Zatím bez případů.");
    expect(sk["projects.reconnect_folder"]).toBe("Znova pripojiť priečinok klienta");
    expect(cs["projects.reconnect_folder"]).toBe("Znovu připojit složku klienta");
    expect(documentProfileCopy.sk.label).toBe("Posúdený profil prípadu");
    expect(documentProfileCopy.cs.label).toBe("Posouzený profil případu");
    expect(sk["lawoss.lite.action_summarize"]).toBe("Zhrň prípad");
    expect(cs["lawoss.lite.action_summarize"]).toBe("Shrň případ");
    expect(sk["lawoss.matters.field.reference"]).toBe("Spisová značka");
    expect(sk["projects.schema.matter_number"]).toBe("Číslo spisu");
  });
});

describe("K5/K6: texty sa prekladajú pri renderi, nie pri uložení", () => {
  test("chyba AI hraníc sa po prepnutí jazyka vykreslí v novom jazyku", () => {
    const stored = sendErrorFromThrown(new Error("Protected AI processing is unavailable. Continue manually without a model."));
    expect(stored).toEqual({ kind: "ai-boundaries" });
    const seen = (["sk", "cs", "en", "de"] as const).map((locale) => { setLocale(locale); return sendErrorText(stored); });
    expect(new Set(seen).size).toBe(4);
    expect(seen[0]).toBe(sk["lawoss.ai_boundaries.chat_refused"]);
    expect(seen[2]).toBe(en["lawoss.ai_boundaries.chat_refused"]);
  });

  test("neutrálna uložená správa sa rozpozná a preloží, iná chyba ostane doslovná", () => {
    setLocale("de");
    expect(aiBoundariesRefusal(AI_BOUNDARIES_STORED_MESSAGE)).toBe(t("lawoss.ai_boundaries.chat_refused"));
    expect(sendErrorText(sendErrorFromThrown(new Error("Disk full")))).toBe("Disk full");
    setLocale("sk");
    expect(sendErrorText({ kind: "failed" })).toBe(sk["home.send_failed"]);
  });

  test("karta povolenia sa pri rovnakom povolení zobrazí v aktuálnom jazyku", () => {
    const permission: PendingPermission = { id: "p1", sessionID: "s1", permission: "bash", patterns: ["ls"], metadata: {}, always: { session: false, project: false }, receivedAt: 1, protocol: "legacy" };
    const render = (locale: Language) => { setLocale(locale); return renderToStaticMarkup(React.createElement(PermissionApprovalPanel, { permission, respondPermission: () => {} })); };
    const sk1 = render("sk");
    const cs1 = render("cs");
    expect(sk1).toContain(sk["session.permission_title_bash"]);
    expect(cs1).toContain(cs["session.permission_title_bash"]);
    expect(cs1).not.toContain(sk["session.permission_title_bash"]);
  });

  test("memo s prekladaným textom závisí od jazyka (karta povolenia, miera uvažovania)", () => {
    const root = join(import.meta.dir, "..", "src", "react-app", "domains", "session");
    const card = readFileSync(join(root, "chat", "permission-approval-modal.tsx"), "utf8");
    expect(card.match(/\[props\.permission, locale\]/g)?.length).toBe(2);
    const behavior = readFileSync(join(root, "surface", "use-model-behavior.ts"), "utf8");
    expect(behavior).toContain("[defaultModel, modelVariant, providerCatalog, locale]");
  });

  test("miera uvažovania má EN a DE preklad, nie slovenský text", () => {
    expect(en["model_behavior.title_reasoning_effort"]).not.toMatch(/uvažovania/);
    expect(de["model_behavior.title_reasoning_effort"]).not.toMatch(/uvažovania/);
  });
});
