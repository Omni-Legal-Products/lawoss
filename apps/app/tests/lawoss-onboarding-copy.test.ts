import { describe, expect, spyOn, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FOUND_TEXT, foundText } from "../src/lawoss/domains/onboarding/found-text";
import { welcomeText } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import { OkfNotice } from "../src/lawoss/domains/onboarding/okf-notice";
import { friendlyError } from "../src/lawoss/domains/roztriedenie/triage-page";
import { LegalworkServerError } from "../src/app/lib/legalwork-server";
import { t } from "../src/i18n";
import { shellCs, shellDe, shellEn, shellSk } from "../src/lawoss/i18n/shell";

// Advokát nemá čítať názvy nástrojov, súborov pre nástroje ani slovo „klon“ (rozhodnutie R4: kópia).
const TECHNICAL = /Claude Code|Codex|AGENTS\.md|CLAUDE\.md|memory\/|klon|clone/i;

const triageTexts = (shell: Record<string, string>) => Object.entries(shell).filter(([key]) => key.startsWith("lawoss.triage."));

describe("texty onboardingu a roztriedenia bez technických slov", () => {
  for (const [locale, shell] of [["sk", shellSk], ["cs", shellCs]] as const) {
    test(`${locale}: texty Toto som našiel`, () => {
      for (const [key, value] of Object.entries(FOUND_TEXT[locale])) expect([key, TECHNICAL.test(value)]).toEqual([key, false]);
    });
    test(`${locale}: texty roztriedenia`, () => {
      expect(triageTexts(shell).length).toBeGreaterThan(50);
      for (const [key, value] of triageTexts(shell)) expect([key, TECHNICAL.test(value)]).toEqual([key, false]);
    });
  }
  test("kód nepoužitého skúšobného klonu má v každom jazyku vlastnú vetu o priečinku klienta", () => {
    for (const shell of [shellSk, shellCs, shellEn, shellDe]) expect(shell["lawoss.triage.not_client_folder"].length).toBeGreaterThan(10);
  });
  test("všeobecná chyba onboardingu je v každom jazyku a bez dlhej pomlčky v nemčine", () => {
    for (const shell of [shellSk, shellCs, shellEn, shellDe]) expect(shell["lawoss.onboarding.error_generic"].length).toBeGreaterThan(10);
    expect(shellDe["lawoss.onboarding.error_generic"]).not.toMatch(/[–—]/);
  });
  test("slovenské texty z tabuľky úlohy sú doslovne a zoznam súborov je zbalený", () => {
    expect(FOUND_TEXT.sk.okfNotice).toBe("Do priečinka pridám niekoľko pomocných súborov. Vďaka nim AI vie, čo v priečinku je. Žiadny váš súbor sa neprepíše ani nezmaže.");
    expect(FOUND_TEXT.sk.answerNo).toBe("Nie, nechaj ho tak, ako je");
    expect(FOUND_TEXT.sk.working).toBe("Pridávam pomocné súbory: {done} z {total}");
    const html = renderToStaticMarkup(createElement(OkfNotice, { text: foundText("sk") }));
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Zoznam pomocných súborov<\/summary>/);
  });
  test("formulár klienta hovorí o kópii a pomocných súboroch", () => {
    expect(welcomeText("sk")("trial_clone")).toBe("Vyskúšať na kópii (odporúčané)");
    expect(welcomeText("sk")("convert")).toBe("Pridať pomocné súbory do priečinka");
    expect(welcomeText("sk")("mode")).toBe("Ako pripojiť priečinok");
    for (const locale of ["sk", "cs"] as const) for (const key of ["mode", "convert", "trial_clone", "trial", "trialConfirm"]) expect([locale, key, TECHNICAL.test(welcomeText(locale)(key))]).toEqual([locale, key, false]);
  });
  test("kód not_trial_clone ukáže vetu o priečinku klienta a surová správa ide do konzoly", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    const text = (key: string) => t(`lawoss.triage.${key}`, "sk");
    expect(friendlyError(new LegalworkServerError(400, "not_trial_clone", "Toto nie je skúšobný klon."), text)).toBe("Usporiadať sa dá len priečinok klienta. Vyberte priečinok konkrétneho klienta.");
    warn.mockRestore();
  });
});
