import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HIDDEN_SETTINGS_TABS, hideCommercialTabs, isCommercialSurfaceHidden } from "../src/lawoss/feature-flags";

/**
 * Rozhodnutie MČ 8. 11. 2026: osobný Assistant upstreamu v0.3.0 (predplatné Eigenwelt Plus/Pro) ostáva skrytý.
 * Jeden prepínač (`CommercialSurface` `assistant`) drží všetky štyri plochy: záložku nastavení, položku bočného
 * panela a jej prepínač v prispôsobení, výber na Domove a výzvu na predplatné pri odoslaní z Domova.
 */
const source = (path: string) => readFileSync(join(import.meta.dir, "../src", path), "utf8");

describe("LAWOSS: upstream Assistant ostáva skrytý", () => {
  test("prepínač plochy a záložka nastavení", () => {
    expect(isCommercialSurfaceHidden("assistant")).toBe(true);
    expect(HIDDEN_SETTINGS_TABS.has("assistant")).toBe(true);
    expect(hideCommercialTabs(["ai", "assistant", "appearance"])).toEqual(["ai", "appearance"]);
  });

  test("bočný panel ani prispôsobenie navigácie Assistanta neponúkajú", () => {
    expect(source("react-app/domains/session/sidebar/app-sidebar.tsx")).toContain('{!isCommercialSurfaceHidden("assistant") && shellConfig.navAssistant !== false && props.onOpenAssistant && <SidebarMenu');
    expect(source("react-app/domains/session/sidebar/sidebar-customization.tsx")).toContain('{isCommercialSurfaceHidden("assistant") ? null : <VisibilityToggle checked={config.navAssistant !== false}');
  });

  test("Domov ho nedá vybrať a bez klienta zakladá klienta, nie výzvu na predplatné", () => {
    const home = source("react-app/domains/session/home/app-home.tsx");
    expect(home).toContain('const assistantHidden = isCommercialSurfaceHidden("assistant");');
    expect(home).toContain("{assistantHidden ? null : <DropdownMenuItem onClick={() => props.onProjectChange(null)}>");
    expect(home).toContain('assistantHidden ? t("home.new_project_hint")');
    const route = source("react-app/shell/session-route.tsx");
    // Upstream v0.3.9 počíta Domov Asistenta raz (`homeAssistant`); LAWOSS ho pri skrytom Asistentovi vypne.
    expect(route).toContain('const homeAssistant = !isCommercialSurfaceHidden("assistant") && (!homeProjectId || workspaces.find(item => item.id === homeProjectId)?.preset === "main-assistant");');
    expect(route).toContain("if (homeAssistant && !assistantIncluded) {");
    // Priestor Assistanta sa medzi klientmi nezobrazí.
    expect(route).toContain('workspace.preset !== "main-assistant"');
  });
});
