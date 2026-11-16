import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { t } from "../src/i18n";

describe("#456: nadpis dialógu výberu priečinka v sprievodcovi", () => {
  test("je v jazyku rozhrania", () => {
    expect(t("lawoss.setup.welcome.pickFolderTitle", "sk")).toBe("Vyberte priečinok pre LAWOSS");
    expect(t("lawoss.setup.welcome.pickFolderTitle", "cs")).toBe("Vyberte složku pro LAWOSS");
    expect(t("lawoss.setup.welcome.pickFolderTitle", "en")).toBe("Select LAWOSS folder");
    expect(t("lawoss.setup.welcome.pickFolderTitle", "de")).toBe("LAWOSS-Ordner auswählen");
  });

  test("sprievodca nepoužíva napevno anglický text", () => {
    const source = readFileSync(join(import.meta.dir, "..", "src/react-app/shell/welcome-route.tsx"), "utf8");
    expect(source).not.toContain('"Select LAWOSS folder"');
    expect(source).toContain('pickDirectory({ title: t("lawoss.setup.welcome.pickFolderTitle"), canonical: true })');
  });
});
