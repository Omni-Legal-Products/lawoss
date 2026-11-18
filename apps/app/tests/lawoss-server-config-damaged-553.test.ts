// LAWOSS #553: poškodený server.json appka oznámi zrozumiteľne, nie ako prázdnu kanceláriu ani „Niečo sa nepodarilo“.
import { afterEach, describe, expect, test } from "bun:test";
import { LegalworkServerError } from "../src/app/lib/legalwork-server";
import { setLocale } from "../src/i18n";
import { onboardingErrorMessage } from "../src/lawoss/domains/onboarding/onboarding-errors";
import { serverConfigWarningNotice, splitServerConfigWarnings } from "../src/lawoss/domains/workspaces/server-config-warning";

afterEach(() => setLocale("en"));

const backup = "/Users/a/.config/legalwork/server.json.poskodeny-2026-11-18T10-00-00-000Z";

describe("#553 varovanie pri poškodenom server.json", () => {
  test("oddelí kódované varovanie od ostatných", () => {
    const other = "1 saved remote agent workspace(s) are no longer supported.";
    expect(splitServerConfigWarnings([other, `LAWOSS_SERVER_CONFIG_DAMAGED|reset|${backup}`])).toEqual({
      damage: [{ kind: "reset", path: backup }],
      others: [other],
    });
  });

  test("cesta s | ostane celá a neznámy druh sa neprekladá", () => {
    expect(splitServerConfigWarnings(["LAWOSS_SERVER_CONFIG_DAMAGED|repaired|/a|b/server.json.poskodeny-1"]).damage).toEqual([{ kind: "repaired", path: "/a|b/server.json.poskodeny-1" }]);
    expect(splitServerConfigWarnings(["LAWOSS_SERVER_CONFIG_DAMAGED|other|/x"])).toEqual({ damage: [], others: ["LAWOSS_SERVER_CONFIG_DAMAGED|other|/x"] });
  });

  test("každý druh má vetu po slovensky s cestou k zálohe", () => {
    setLocale("sk");
    for (const kind of ["repaired", "reset", "restored", "kept"] as const) {
      const notice = serverConfigWarningNotice({ kind, path: backup });
      expect(notice.title).toBe("Súbor nastavení kancelárie bol poškodený");
      expect(notice.body).toContain(backup);
      expect(notice.body).not.toContain("lawoss.");
    }
    expect(serverConfigWarningNotice({ kind: "reset", path: backup }).body).toContain("Súbory klientov sa nezmenili");
  });

  test("česky", () => {
    setLocale("cs");
    expect(serverConfigWarningNotice({ kind: "restored", path: backup }).title).toBe("Soubor nastavení kanceláře byl poškozený");
  });

  test("onboarding pri poškodenom server.json nepovie len „Niečo sa nepodarilo“", () => {
    const error = new LegalworkServerError(422, "invalid_json", "Failed to parse server config", { path: "/p/server.json", error: "SyntaxError" });
    const message = onboardingErrorMessage(error, "sk");
    expect(message).toContain("/p/server.json");
    expect(message).not.toBe(onboardingErrorMessage(new Error("x"), "sk"));
  });
});
