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
import { defaultProjectTemplates, localizedProjectFields, projectFieldLabel, projectTemplateName } from "../../../packages/types/src/project-templates";
import { documentProfileCopy } from "../src/react-app/domains/session/panel/document-processing";
import { AI_BOUNDARIES_STORED_MESSAGE, aiBoundariesRefusal } from "../src/lawoss/domains/ai/boundaries-refusal";
import { sendErrorFromThrown, sendErrorText } from "../src/lawoss/domains/ai/send-error";
import { rememberedApprovalKeys } from "../src/lawoss/lite/file-operation-card";
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
    for (const value of Object.entries(de).filter(([key]) => key.startsWith("lawoss.")).map(([, v]) => v)) {
      expect(String(value)).not.toMatch(/\bAkten?\b|\bAkten(?!zeichen)[a-zäöüß]+|Angelegenheit/);
    }
    expect("Akteure und Aktenzeichen").not.toMatch(/\bAkten?\b|\bAkten(?!zeichen)[a-zäöüß]+/);
  });

  test("nemecká gramatika po zámene rodu a zvyšky Akte / Mandat / Session", () => {
    setLocale("de");
    expect(t("project_sync.keep_local")).toBe("Als eigenen Mandanten behalten");
    expect(t("project_sync.owner_only_short")).toBe("Nur die Person, der der Mandant gehört, kann das ändern.");
    expect(t("welcome.project_creating")).toBe("Ihr Mandant wird erstellt…");
    expect(t("benchmark.transcript_readonly")).toContain("Schreibgeschützter Eval-Chat");
    expect(t("tasks.created_by_agent")).toBe("Vom LAWOSS-Agenten, in einem Chat");
    expect(t("projects.reconnect_folder")).toBe("Mandantenordner erneut verbinden");
    expect(t("session.cmd_new_session_title")).toBe("Neuer Chat");
    expect(t("session.workspace_files")).toBe("Mandantendateien");
    expect(t("open_computer_use.local_only")).toContain("lokalen Arbeitsbereich");
    setLocale("en");
    expect(t("projects.reconnect_folder")).toBe("Reconnect client folder");
    expect(t("session.cmd_new_session_title")).toBe("New chat");
    expect(t("session.workspace_files")).toBe("Client Files");
    expect(t("open_computer_use.local_only")).toContain("local workspace");
    const effectiveDe: Record<string, string> = { ...de, ...termsDe };
    const effectiveEn: Record<string, string> = { ...en, ...termsEn };
    const leftovers = Object.entries(effectiveDe)
      .filter(([, value]) => /\bAkten?\b|\bAkten(?!zeichen)[a-zäöüß]+|\bAngelegenheit|\bMandat(e|en|s)?\b/.test(value));
    expect(leftovers.map(([key]) => key)).toEqual([]);
    const enLeft = Object.entries(effectiveEn)
      .filter(([, value]) => /\bmatters?\b/i.test(value.replace(/\{[^}]*\}|features? (you use )?matter|details that matter/gi, "")))
      .map(([key]) => key);
    expect(enLeft).toEqual([]);
  });

  test("YOLO: pravdivé o Koši, skrytom .lawoss-kos a priamych príkazoch", () => {
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      setLocale(locale);
      expect(t("lawoss.yolo.confirm_undo")).toContain(".lawoss-kos");
      expect(t("lawoss.yolo.confirm_undo")).toContain("rm");
    }
  });

  test("profil prípadu v dokumentoch používa Case / Fall", () => {
    expect(documentProfileCopy.en.label).toContain("case");
    expect(documentProfileCopy.de.label).toBe("Geprüftes Profil und Fall");
  });
});

describe("SK a CS: Prípad / Případ namiesto spisu (N-3, F1, N-6)", () => {
  // Právne pojmy a doslovný názov priečinka: „Číslo spisu“, priečinok „Spisy“.
  const LEFT_TO_C1 = new Set(["lawoss.setup.wizard.clientRootHint", "projects.schema.matter_number"]);
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

  // Obmedzenie: v teste nie je DOM, takže sa nedá skutočne prekresliť strom po prepnutí jazyka
  // (renderToStaticMarkup rátá vždy nanovo). Preto sú nižšie stráže nad zdrojom: ak niekto
  // odstráni `useLocale()` alebo jazyk z deps memoizácie, test zlyhá.
  test("memoizácie s prekladaným textom závisia od jazyka (karta povolenia, miera uvažovania)", () => {
    const root = join(import.meta.dir, "..", "src", "react-app", "domains", "session");
    const card = readFileSync(join(root, "chat", "permission-approval-modal.tsx"), "utf8");
    expect(card.match(/const locale = useLocale\(\);/g)?.length).toBe(2);
    const memos = [...card.matchAll(/useMemo\(\(\) => describePermissionRequest\(props\.permission\), (\[[^\]]*\])\)/g)].map((m) => m[1]);
    expect(memos).toEqual(["[props.permission, locale]", "[props.permission, locale]"]);
    const behavior = readFileSync(join(root, "surface", "use-model-behavior.ts"), "utf8");
    expect(behavior).toContain("const locale = useLocale();");
    expect(behavior).toMatch(/useMemo\(\(\) => \{[\s\S]*?\}, \[defaultModel, modelVariant, providerCatalog, locale\]\);/);
  });

  test("chyba AI hraníc sa v karte relácie a v zozname správ prekladá pri renderi", () => {
    const surface = readFileSync(join(import.meta.dir, "..", "src", "react-app", "domains", "session", "surface", "session-surface.tsx"), "utf8");
    expect(surface).toContain('error.kind === "ai-boundaries" ? aiBoundariesRefusal(error.message) : error.message');
    expect(surface).toContain('message: AI_BOUNDARIES_STORED_MESSAGE, kind: "ai-boundaries"');
    const list = readFileSync(join(import.meta.dir, "..", "src", "components", "chat", "message-list.tsx"), "utf8");
    expect(list).toContain("aiBoundariesRefusal(error) ?? error");
  });

  test("miera uvažovania má EN a DE preklad, nie slovenský text", () => {
    expect(en["model_behavior.title_reasoning_effort"]).not.toMatch(/uvažovania/);
    expect(de["model_behavior.title_reasoning_effort"]).not.toMatch(/uvažovania/);
  });
});

describe("karta povolenia: pamätanie podľa druhu karty (review B2 kolo 2)", () => {
  test("engine karta pamätá pre klienta, host karta pre chat", () => {
    expect(rememberedApprovalKeys({ protocol: "legacy" }).label).toBe("lawoss.permission.allow_for_client");
    expect(rememberedApprovalKeys({ protocol: "v2" }).label).toBe("lawoss.permission.allow_for_client");
    expect(rememberedApprovalKeys({ protocol: "host" }).label).toBe("session.allow_for_session");
    expect(rememberedApprovalKeys({ protocol: "host" }).hint).toBe("session.permission_decision_hint");
    const expected = { sk: "Povoliť pre tohto klienta", cs: "Povolit pro tohoto klienta", en: "Allow for this client", de: "Für diesen Mandanten erlauben" } as const;
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      setLocale(locale);
      expect(t(rememberedApprovalKeys({ protocol: "legacy" }).label)).toBe(expected[locale]);
      expect(t(rememberedApprovalKeys({ protocol: "legacy" }).hint)).not.toMatch(/konverzác|konverzac|chat/i);
    }
  });

  test("vykreslená karta ukazuje správny popisok podľa protokolu", () => {
    const base: PendingPermission = { id: "p2", sessionID: "s1", permission: "bash", patterns: ["ls"], metadata: {}, always: { session: false, project: false }, receivedAt: 1, protocol: "legacy" };
    setLocale("cs");
    const engine = renderToStaticMarkup(React.createElement(PermissionApprovalPanel, { permission: base, respondPermission: () => {} }));
    expect(engine).toContain("Povolit pro tohoto klienta");
    expect(engine).not.toContain("do konce konverzace");
  });
});

describe("zákonné aliasy: staré uložené štítky a názvy šablón sa ďalej prekladajú (review B2 kolo 2)", () => {
  test("pole bez labelSource so starým EN štítkom sa preloží na nový", () => {
    const legacy = { id: "matter_number", label: "Matter reference", type: "text" as const, value: null };
    expect(projectFieldLabel(legacy, "sk")).toBe("Číslo spisu");
    expect(projectFieldLabel(legacy, "en")).toBe("Case number");
    expect(projectFieldLabel({ id: "subject", label: "Matter subject", type: "text", value: null }, "cs")).toBe("Předmět případu");
    expect(localizedProjectFields([legacy], "de")[0]?.labelSource).toBe("suggested");
    expect(projectFieldLabel({ ...legacy, labelSource: "custom" }, "sk")).toBe("Matter reference");
    expect(projectFieldLabel({ ...legacy, label: "Moje vlastné" }, "sk")).toBe("Moje vlastné");
  });

  test("šablóna bez nameSource so starým názvom sa preloží, vlastný názov ostane", () => {
    const [legal, internal] = defaultProjectTemplates("en");
    expect(legal && internal).toBeTruthy();
    for (const old of ["Legal Matter", "Akte", "Právny spis", "Právní spis"]) {
      expect(projectTemplateName({ id: "legal_matter", name: old, fields: [] }, "de")).toBe("Fall");
    }
    expect(projectTemplateName({ id: "internal", name: "Internal Project", fields: [] }, "en")).toBe("Internal Work");
    expect(projectTemplateName({ id: "legal_matter", name: "Moja šablóna", fields: [] }, "de")).toBe("Moja šablóna");
    expect(projectTemplateName({ id: "legal_matter", name: "Akte", nameSource: "custom", fields: [] }, "de")).toBe("Akte");
  });
});
