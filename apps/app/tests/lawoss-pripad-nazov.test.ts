import { describe, expect, test } from "bun:test";
import { shellCs, shellSk } from "../src/lawoss/i18n/shell";
import { mattersCs, mattersSk } from "../src/lawoss/i18n/matters";
import { setupCs, setupSk } from "../src/lawoss/i18n/setup";
import { integrationsCs, integrationsSk } from "../src/lawoss/i18n/integrations";
import { FOUND_TEXT } from "../src/lawoss/domains/onboarding/found-text";
import { welcomeText } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import { MORE_ACTIONS, QUICK_ACTIONS, composeQuickAction } from "../src/lawoss/lite/quick-actions";

// Rozhodnutie MČ 19. 10. 2026: jednotka práce pod klientom je v rozhraní „Prípad“ (SK) / „Případ“ (CS),
// nie „vec“ / „věc“. Kľúče, trasy (`?vec=`) a formát OKF ostávajú.
const OLD_SK = /(?<!\p{L})[Vv]ec(i|ou|í|iam|ami|iach)?(?!\p{L})/u;
const OLD_CS = /(?<!\p{L})[Vv]ěc(i|í|em|mi|ech)?(?!\p{L})/u;
const OLD = new RegExp(`${OLD_SK.source}|${OLD_CS.source}`, "u");

const withOld = (dict: Record<string, string>): string[] =>
  Object.entries(dict).filter(([, value]) => OLD.test(value)).map(([key, value]) => `${key}: ${value}`);

describe("Prípad namiesto veci (SK, CS)", () => {
  test("slovníky LAWOSS v SK a CS už nehovoria o veci", () => {
    for (const dict of [shellSk, shellCs, mattersSk, mattersCs, setupSk, setupCs, integrationsSk, integrationsCs, FOUND_TEXT.sk, FOUND_TEXT.cs]) {
      expect(withOld(dict)).toEqual([]);
    }
  });

  test("hlavné popisky v bočnom paneli, na Klientoch a v strome", () => {
    expect(shellSk["lawoss.lite.nav_clients"]).toBe("Klienti a prípady");
    expect(shellCs["lawoss.lite.nav_clients"]).toBe("Klienti a případy");
    expect(shellSk["lawoss.lite.new_matter"]).toBe("Nový prípad");
    expect(shellCs["lawoss.lite.new_matter"]).toBe("Nový případ");
    expect(shellSk["lawoss.lite.scope_matter"]).toBe("Prípad");
    expect(shellCs["lawoss.lite.scope_matter"]).toBe("Případ");
    expect(shellSk["lawoss.lite.client_no_matters"]).toBe("Zatiaľ bez prípadov.");
    expect(shellCs["lawoss.lite.client_no_matters"]).toBe("Zatím bez případů.");
    expect(shellSk["lawoss.triage.new_matter_badge"]).toBe("nový prípad");
    expect(shellCs["lawoss.triage.new_matter_badge"]).toBe("nový případ");
  });

  test("onboarding: formulár nového prípadu", () => {
    const sk = welcomeText("sk");
    const cs = welcomeText("cs");
    expect(sk("matter")).toBe("Prvý prípad");
    expect(cs("matter")).toBe("První případ");
    expect(sk("newMatter")).toBe("Nový prípad");
    expect(cs("newMatter")).toBe("Nový případ");
    expect(sk("matterUnder")).toBe("Prípad vznikne pod klientom");
    expect(cs("matterUnder")).toBe("Případ vznikne pod klientem");
    expect(sk("noClientYet")).toBe("Vyberte priečinok klienta, pod ktorým prípad vznikne.");
    expect(cs("noClientYet")).toBe("Vyberte složku klienta, pod kterým případ vznikne.");
    for (const key of ["matter", "kind", "non_contentious", "done", "newMatter", "matterUnder", "noClientYet"]) {
      expect(sk(key)).not.toMatch(OLD);
      expect(cs(key)).not.toMatch(OLD);
    }
  });

  test("rýchle akcie hovoria o prípade", () => {
    const matter = { title: "Novák - 14 C 101/2025", matterRef: "14 C 101/2025", path: "Klienti/Novák/Spisy/Odvolanie" };
    for (const id of ["open", ...QUICK_ACTIONS.map((a) => a.id), ...MORE_ACTIONS.map((a) => a.id)] as const) {
      expect(composeQuickAction(id, matter, "sk")).not.toMatch(OLD);
      expect(composeQuickAction(id, matter, "cs")).not.toMatch(OLD);
    }
    expect(composeQuickAction("open", matter, "sk")).toContain("Pracujeme na prípade");
    expect(composeQuickAction("open", matter, "cs")).toContain("Pracujeme na případu");
  });
});
