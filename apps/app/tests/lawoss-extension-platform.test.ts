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
const computerUse = extensionCatalog.find((entry) => entry.id === "computer-use");

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
  test("Computer Use je v katalógu len pre macOS", () => {
    expect(computerUse?.extensionManifest?.platform).toEqual(["darwin"]);
    expect(isExtensionAvailableOnPlatform(computerUse!, "darwin")).toBe(true);
    for (const platform of ["windows", "linux", "web"] as const) {
      expect(isExtensionAvailableOnPlatform(computerUse!, platform)).toBe(false);
    }
  });

  test("rozšírenie bez obmedzenia platformy ostáva všade", () => {
    const anywhere = { ...computerUse!, id: "anywhere", extensionManifest: { ...computerUse!.extensionManifest!, platform: undefined } };
    for (const platform of ["darwin", "windows", "linux", "web"] as const) {
      expect(isExtensionAvailableOnPlatform(anywhere, platform)).toBe(true);
    }
  });

  test("preload pre win32 dá platformu windows a composer Computer Use neponúkne", () => {
    expect(preloadPlatform("win32")).toBe("windows");
    expect(preloadPlatform("darwin")).toBe("darwin");
    expect(composerCatalog(preloadPlatform("win32"))).not.toContain("computer-use");
    expect(composerCatalog(preloadPlatform("darwin"))).toContain("computer-use");
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

  // Composer sa v testoch nerenderuje (desiatky props); stráž, aby upstream sync
  // nevrátil ponuku bez platformového filtra a so zdrojom platformy mimo Nastavení.
  test("composer filtruje rozšírenia platformou z mostíka Electronu", () => {
    const composer = readFileSync(
      join(import.meta.dir, "..", "src/react-app/domains/session/surface/composer/composer.tsx"),
      "utf8",
    );
    expect(composer).toContain('window.__LEGALWORK_ELECTRON__?.meta?.platform ?? "web"');
    expect(composer).toMatch(/LEGALWORK_EXTENSION_CATALOG\.filter\([\s\S]{0,200}isExtensionAvailableOnPlatform\(entry, extensionPlatform\)/);
  });

  test.skipIf(process.platform !== "win32")("na skutočnom Windows preload hlási windows a Computer Use chýba", () => {
    const platform = preloadPlatform(process.platform);
    expect(platform).toBe("windows");
    expect(composerCatalog(platform)).not.toContain("computer-use");
  });
});
