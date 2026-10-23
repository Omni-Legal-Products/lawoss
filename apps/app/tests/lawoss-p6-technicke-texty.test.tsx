// LAWOSS P6 (test 24. 10. 2026, N-A3-6): advokát nevidí technické texty.
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { currentLocale, setLocale, type Language } from "../src/i18n";
import { getDisplaySessionTitle } from "../src/app/lib/session-title";

const initial: Language = currentLocale();
afterEach(() => setLocale(initial));
const source = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf8");

describe("nová karta chatu nemá názov enginu „New session - …“", () => {
  test("predvolený názov enginu sa ukáže po slovensky, česky, anglicky a nemecky", () => {
    const engineTitle = `New session - ${new Date("2026-10-24T13:35:00.000Z").toISOString()}`;
    const expected: Record<Language, string> = { sk: "Nový chat", cs: "Nový chat", en: "New chat", de: "Neuer Chat" };
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      setLocale(locale);
      expect(getDisplaySessionTitle(engineTitle)).toBe(expected[locale]);
    }
    expect(getDisplaySessionTitle("Presun PDF na NAS")).toBe("Presun PDF na NAS");
  });

  test("karta chatu z „+“ aj uložené karty idú cez zobrazovaný názov", () => {
    expect(source("src/react-app/shell/session-route.tsx")).toContain("label: getDisplaySessionTitle(session.title)");
    expect(source("src/react-app/shell/session-route.tsx")).not.toContain("label: session.title ||");
    expect(source("src/react-app/domains/session/panel/side-panel.tsx")).toContain('tab.type === "chat" ? getDisplaySessionTitle(tab.label)');
  });
});
