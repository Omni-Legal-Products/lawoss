import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

import { MCP_QUICK_CONNECT_ALL } from "../src/app/constants";
import { buildExtensionItems, isExtensionAvailableOnPlatform } from "../src/react-app/domains/settings/extension-items";

type Platform = "darwin" | "linux" | "windows" | "web";

const repoRoot = join(import.meta.dir, "..", "..", "..");
// Katalóg rozšírení so zapnutým zdrojom LegalWork; bez neho LAWOSS Computer Use
// neponúka vôbec (`isHiddenQuickConnect` v src/lawoss/feature-flags.ts).
const extensionCatalog = MCP_QUICK_CONNECT_ALL.filter((entry) => entry.kind === "extension");
// Od v0.2.9 nahradil macOS Computer Use upstream Open Computer Use (macOS a Windows, #274).
const computerUse = extensionCatalog.find((entry) => entry.id === "open-computer-use");

/**
 * `meta.platform` tak, ako ho appke dá skutočný preload Electronu pre zadaný
 * `process.platform` (rovnaký sandbox ako apps/desktop/electron/sandbox-preloads.test.mjs).
 */
function preloadPlatform(nodePlatform: string): Platform {
  const exposed = new Map<string, { meta: { platform: Platform } }>();
  const ipc = { on() {}, removeListener() {}, send() {}, invoke: async () => null };
  vm.runInNewContext(readFileSync(join(repoRoot, "apps/desktop/electron/preload.cjs"), "utf8"), {
    require: () => ({ ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (name: string, value: never) => exposed.set(name, value) } }),
    process: { platform: nodePlatform, versions: { electron: "0.0.0" } },
    window: { addEventListener() {}, dispatchEvent() {} },
    document: { documentElement: { dataset: {}, classList: { add() {} } }, addEventListener() {} },
  });
  const bridge = exposed.get("__LEGALWORK_ELECTRON__");
  if (!bridge) throw new Error("preload.cjs did not expose __LEGALWORK_ELECTRON__");
  return bridge.meta.platform;
}

/** Rovnaký filter, aký composer používa pre ponuku rozšírení. */
const composerCatalog = (platform: Platform) =>
  extensionCatalog.filter((entry) => isExtensionAvailableOnPlatform(entry, platform)).map((entry) => entry.id);

describe("rozšírenia podľa platformy (composer aj Nastavenia)", () => {
  test("Open Computer Use je v katalógu len pre macOS a Windows", () => {
    expect(computerUse?.extensionManifest?.platform).toEqual(["darwin", "windows"]);
    expect(isExtensionAvailableOnPlatform(computerUse!, "darwin")).toBe(true);
    expect(isExtensionAvailableOnPlatform(computerUse!, "windows")).toBe(true);
    for (const platform of ["linux", "web"] as const) {
      expect(isExtensionAvailableOnPlatform(computerUse!, platform)).toBe(false);
    }
  });

  test("rozšírenie bez obmedzenia platformy ostáva všade", () => {
    const anywhere = { ...computerUse!, id: "anywhere", extensionManifest: { ...computerUse!.extensionManifest!, platform: undefined } };
    for (const platform of ["darwin", "windows", "linux", "web"] as const) {
      expect(isExtensionAvailableOnPlatform(anywhere, platform)).toBe(true);
    }
  });

  test("preload pre win32 dá platformu windows; Open Computer Use chýba len na Linuxe", () => {
    expect(preloadPlatform("win32")).toBe("windows");
    expect(preloadPlatform("darwin")).toBe("darwin");
    expect(preloadPlatform("linux")).toBe("linux");
    expect(composerCatalog(preloadPlatform("win32"))).toContain("open-computer-use");
    expect(composerCatalog(preloadPlatform("darwin"))).toContain("open-computer-use");
    expect(composerCatalog(preloadPlatform("linux"))).not.toContain("open-computer-use");
  });

  test("composer a Nastavenia vidia na Windows ten istý katalóg", () => {
    const settings = buildExtensionItems({
      quickConnect: extensionCatalog,
      platform: "windows",
      mcpServers: [],
      installedSkills: [],
      enablementContext: {},
      isBuiltInConnected: () => false,
    });
    expect(settings.quickConnectEntries.map((entry) => entry.id).sort()).toEqual(composerCatalog("windows").sort());
    expect(settings.builtInItems.map((item) => item.builtInEntry?.id)).not.toContain("computer-use");
  });

  // Composer sa v testoch nerenderuje (desiatky props). Od v0.2.9 upstream ponuku katalógu
  // rozšírení z composera odstránil; ak ju sync vráti, musí mať platformový filter.
  test("composer neponúka katalóg rozšírení bez platformového filtra", () => {
    const composer = readFileSync(
      join(import.meta.dir, "..", "src/react-app/domains/session/surface/composer/composer.tsx"),
      "utf8",
    );
    if (!composer.includes("LEGALWORK_EXTENSION_CATALOG")) return;
    expect(composer).toContain('window.__LEGALWORK_ELECTRON__?.meta?.platform ?? "web"');
    expect(composer).toMatch(/LEGALWORK_EXTENSION_CATALOG\.filter\([\s\S]{0,200}isExtensionAvailableOnPlatform\(entry, extensionPlatform\)/);
  });

  test.skipIf(process.platform !== "win32")("na skutočnom Windows preload hlási windows a ponúkne Open Computer Use", () => {
    const platform = preloadPlatform(process.platform);
    expect(platform).toBe("windows");
    expect(composerCatalog(platform)).toContain("open-computer-use");
  });
});
