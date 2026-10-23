// LAWOSS P6 (test 24. 10. 2026, N-A3-6): advokát nevidí technické texty.
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { currentLocale, setLocale, t, type Language } from "../src/i18n";
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

describe("detail skillu v Integráciách nie je po anglicky (V14)", () => {
  const modal = () => source("src/react-app/design-system/extension-detail-modal.tsx");
  test("popisky nie sú napevno anglické", () => {
    for (const label of ["Details", "Type", "Location", "Status", "Visibility", "Endpoint", "Launch", "Authentication", "Availability", "Trigger", "Setup", "Preview", "Show", "Hide"])
      expect(modal().match(new RegExp(`>\\s*${label}\\s*<`))?.[0] ?? null).toBeNull();
    for (const value of ["Installed", "Connected", "Not installed", "Not connected", "Hidden", "Shown", "Uninstall", "Disconnect"])
      expect(modal().includes(`"${value}"`) ? value : null).toBeNull();
  });
  test("SK, CS a DE majú vlastné texty detailu", () => {
    const keys = ["session.details_label", "mcp.server_type", "extension_detail.location", "identities.status_label", "skills.installed_status",
      "extension_detail.visibility", "extension_detail.shown", "extension_card.hidden", "common.hide", "office_addins.uninstall", "extension_detail.not_installed",
      "extension_detail.trigger", "extension_detail.availability", "extension_detail.setup"];
    const expected: Record<"sk" | "cs" | "de", string[]> = {
      sk: ["Podrobnosti", "Typ", "Umiestnenie", "Stav", "Nainštalované", "Viditeľnosť", "Zobrazené", "Skryté", "Skryť", "Odinštalovať", "Nenainštalované", "Kedy sa použije", "Dostupnosť", "Nastavenie"],
      cs: ["Podrobnosti", "Typ", "Umístění", "Stav", "Nainstalováno", "Viditelnost", "Zobrazeno", "Skryté", "Skrýt", "Odinstalovat", "Nenainstalováno", "Kdy se použije", "Dostupnost", "Nastavení"],
      de: ["Details", "Typ", "Speicherort", "Status", "Installiert", "Sichtbarkeit", "Angezeigt", "Ausgeblendet", "Ausblenden", "Deinstallieren", "Nicht installiert", "Wann er verwendet wird", "Verfügbarkeit", "Einrichtung"],
    };
    for (const locale of ["sk", "cs", "de"] as const) {
      setLocale(locale);
      expect(keys.map((key) => t(key))).toEqual(expected[locale]);
    }
  });
});
