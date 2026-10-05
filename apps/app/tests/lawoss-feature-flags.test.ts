import { describe, expect, test } from "bun:test";

import {
  HIDDEN_QUICK_CONNECT_SERVERS,
  HIDDEN_SIDEBAR_ITEMS,
  HIDDEN_SETTINGS_TABS,
  hideCommercialSidebarItems,
  hideCommercialTabs,
  isCommercialSurfaceHidden,
  isHiddenQuickConnect,
  isHiddenSettingsTab,
} from "../src/lawoss/feature-flags";

describe("LAWOSS feature flags", () => {
  test("odstráni komerčné záložky a poradie ostatných zachová", () => {
    const tabs = ["account", "ai", "recorder", "extensions", "appearance"];
    expect(hideCommercialTabs(tabs)).toEqual(["ai", "extensions", "appearance"]);
  });

  test("nič iné neodstráni", () => {
    const tabs = ["ai", "extensions", "personalisation", "appearance", "updates"];
    expect(hideCommercialTabs(tabs)).toEqual(tabs);
  });

  test("skryté sú účet a recorder", () => {
    expect(HIDDEN_SETTINGS_TABS.has("account")).toBe(true);
    expect(HIDDEN_SETTINGS_TABS.has("recorder")).toBe(true);
    expect(HIDDEN_SETTINGS_TABS.has("ai")).toBe(false);
  });

  test("recorder sa neponúka ani v prispôsobení navigácie", () => {
    const items = ["navHome", "navRecorder", "navProjects"];
    expect(HIDDEN_SIDEBAR_ITEMS.has("navRecorder")).toBe(true);
    expect(hideCommercialSidebarItems(items)).toEqual(["navHome", "navProjects"]);
  });

  test("LegalMemory sa neponúka v rýchlom pripojení; upstream položky len so zdrojom LegalWork", () => {
    expect(HIDDEN_QUICK_CONNECT_SERVERS.has("legalmemory")).toBe(true);
    expect(isHiddenQuickConnect("legalmemory")).toBe(true);
    // Zdroj LegalWork je predvolene vypnutý a allowlist LAWOSS je prázdny (lawoss-quick-connect.test.ts).
    expect(isHiddenQuickConnect("notion")).toBe(true);
  });

  test("firemné zdieľanie a trial oznámenie sú skryté", () => {
    expect(isCommercialSurfaceHidden("firm-hub")).toBe(true);
    expect(isCommercialSurfaceHidden("ai-plans")).toBe(true);
    expect(isCommercialSurfaceHidden("trial-notice")).toBe(true);
  });

  test("ponuka Plus, prihlásenie do Eigenweltu a výzvy na skúšobnú verziu sú skryté", () => {
    expect(isCommercialSurfaceHidden("premium-upsell")).toBe(true);
    expect(isCommercialSurfaceHidden("eigenwelt-account")).toBe(true);
    expect(isCommercialSurfaceHidden("eigenwelt-sign-in")).toBe(true);
    expect(isCommercialSurfaceHidden("eigenwelt-trial")).toBe(true);
  });
});

describe("onboarding nesmie zapínať to, čo je skryté", () => {
  test("recorder je skrytá záložka, takže krok prepisu sa preskočí", () => {
    expect(isHiddenSettingsTab("recorder")).toBe(true);
    expect(isHiddenSettingsTab("account")).toBe(true);
    expect(isHiddenSettingsTab("ai")).toBe(false);
    expect(isHiddenSettingsTab("extensions")).toBe(false);
  });
});
