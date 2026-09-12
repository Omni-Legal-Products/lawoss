import { describe, expect, test } from "bun:test";

import {
  HIDDEN_QUICK_CONNECT_SERVERS,
  HIDDEN_SETTINGS_TABS,
  hideCommercialTabs,
  isCommercialSurfaceHidden,
  isHiddenQuickConnect,
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

  test("LegalMemory sa neponúka v rýchlom pripojení", () => {
    expect(HIDDEN_QUICK_CONNECT_SERVERS.has("legalmemory")).toBe(true);
    expect(isHiddenQuickConnect("legalmemory")).toBe(true);
    expect(isHiddenQuickConnect("slovlex")).toBe(false);
  });

  test("firemné zdieľanie a trial oznámenie sú skryté", () => {
    expect(isCommercialSurfaceHidden("firm-hub")).toBe(true);
    expect(isCommercialSurfaceHidden("trial-notice")).toBe(true);
  });

  test("ponuka Plus, prihlásenie do Eigenweltu a výzvy na skúšobnú verziu sú skryté", () => {
    expect(isCommercialSurfaceHidden("premium-upsell")).toBe(true);
    expect(isCommercialSurfaceHidden("eigenwelt-sign-in")).toBe(true);
    expect(isCommercialSurfaceHidden("eigenwelt-trial")).toBe(true);
  });
});
