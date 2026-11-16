import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { integrationsCs, integrationsDe, integrationsEn, integrationsSk } from "../src/lawoss/i18n/integrations";

// #515: neplatný odkaz na záložku „Plugins“ a anglické texty natvrdo v dialógu „Nový skill“.
const dictionaries = { en: integrationsEn, cs: integrationsCs, sk: integrationsSk, de: integrationsDe };
const installedLabel = { en: "Installed", cs: "Nainstalováno", sk: "Nainštalované", de: "Installiert" };

describe("preklady #515", () => {
  for (const [lang, dict] of Object.entries(dictionaries)) {
    test(`${lang}: popis Marketplace neodkazuje na neexistujúcu záložku Plugins`, () => {
      const description = dict["lawoss.marketplace.catalog.description"];
      expect(description).not.toMatch(/Plugins/u);
      expect(description).toContain(installedLabel[lang as keyof typeof installedLabel]);
    });

    test(`${lang}: dialóg Nový skill má preložené pole Názov a tlačidlo`, () => {
      expect(dict["lawoss.skills.field_name"]?.trim()).toBeTruthy();
      expect(dict["lawoss.skills.create"]?.trim()).toBeTruthy();
    });
  }

  test("skills-view.tsx nemá v dialógu Nový skill anglické texty natvrdo", () => {
    const source = readFileSync(join(import.meta.dir, "..", "src", "react-app", "domains", "settings", "pages", "skills-view.tsx"), "utf8");
    expect(source).not.toContain(">Name</span>");
    expect(source).not.toContain(">Instructions</span>");
    expect(source).not.toContain("Step-by-step instructions the agent follows when this skill is active.");
    expect(source).not.toMatch(/^\s*"Create skill"\s*$/mu);
  });
});
