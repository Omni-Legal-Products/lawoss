import { afterEach, beforeEach, expect, test } from "bun:test";
import type { PluginImportPreview } from "@legalwork/types/plugin-import";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { createLegalworkServerStore } from "../src/react-app/domains/connections/legalwork-server-store";
import { createExtensionsStore } from "../src/react-app/domains/settings/state/extensions-store";

const preview: PluginImportPreview = {
  id: "import:claude:github", name: "github", description: null, version: null, format: "claude", root: ".", digest: "reviewed", fileCount: 2, bytes: 100,
  components: [{ type: "mcp", name: "github", installedName: "imported-github" }, { type: "skill", name: "review", installedName: "github-review" }], warnings: [],
};
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalFetch = globalThis.fetch;
let skillReads = 0;
let skillReadStarted: (() => void) | undefined;
let skillReadWait: Promise<void> | undefined;
let imported = false;
let importWrites = 0;
let finishConnectors: (() => void) | undefined;
let connectorWait: Promise<void> | undefined;
let connectorNames: readonly string[] = [];

function makeStore() {
  const legalworkServer = createLegalworkServerStore({
    startupPreference: () => "local", documentVisible: () => true, developerMode: () => false, runtimeWorkspaceId: () => null, activeClient: () => null,
    selectedWorkspaceDisplay: () => ({ id: "local", name: "Local", path: "/tmp/workspace", preset: "", workspaceType: "local" }),
    restartLocalServer: async () => false, createRemoteWorkspaceFlow: async () => false,
  });
  return createExtensionsStore({
    client: () => null, projectDir: () => "/tmp/workspace", selectedWorkspaceId: () => "local", selectedWorkspaceRoot: () => "/tmp/workspace", workspaceType: () => "local", legalworkServer,
    legalworkServerConnection: () => ({ legalworkServerClient: createLegalworkServerClient({ baseUrl: "http://127.0.0.1:9001", token: "test" }), legalworkServerStatus: "connected", legalworkServerCapabilities: null }),
    runtimeWorkspaceId: () => "local", setBusy: () => {}, setBusyLabel: () => {}, setBusyStartedAt: () => {}, setError: () => {},
    refreshConnectors: async names => { connectorNames = names; finishConnectors?.(); await connectorWait; },
  });
}

beforeEach(() => {
  skillReads = 0; imported = false; importWrites = 0; skillReadStarted = undefined; skillReadWait = undefined; finishConnectors = undefined; connectorWait = undefined; connectorNames = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __LEGALWORK_ELECTRON__: {
    invokeDesktop: async (command: string) => {
      if (command !== "listLocalSkills") throw new Error(`Unexpected desktop command: ${command}`);
      skillReads += 1;
      const items = imported ? [{ name: "github-review", path: "/tmp/SKILL.md", description: "Review code" }] : [];
      skillReadStarted?.();
      await skillReadWait;
      return { items, skipped: [] };
    },
  } } });
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path.endsWith("/plugin-imports/install")) { imported = true; importWrites += 1; return Response.json({ preview }); }
    if (path.endsWith("/firm-hub/skills")) return Response.json({ items: [] });
    throw new Error(`Unexpected request: ${request.url}`);
  };
});
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  globalThis.fetch = originalFetch;
});

test("finishing an import waits for connector publication and a fresh read after a pre-import skills scan", async () => {
  let releaseSkills = () => {};
  skillReadWait = new Promise<void>(resolve => { releaseSkills = resolve; });
  const started = new Promise<void>(resolve => { skillReadStarted = resolve; });
  const store = makeStore();
  const oldScan = store.refreshSkills({ force: true });
  await started;
  const result = await store.installPluginImport({ source: { provider: "claude", path: "/tmp/github" }, scope: "global", digest: preview.digest });
  let complete = false;
  const finishing = store.refreshPluginImport(result).then(() => { complete = true; });
  await Promise.resolve();
  expect(complete).toBe(false);
  skillReadWait = undefined;
  releaseSkills();
  await oldScan;
  await finishing;
  expect(skillReads).toBe(2);
  expect(connectorNames).toEqual(["imported-github"]);
  expect(store.skills().map(skill => skill.name)).toEqual(["github-review"]);
  store.dispose();
});

test("import completion remains pending while connector publication is delayed", async () => {
  let releaseConnectors = () => {};
  connectorWait = new Promise<void>(resolve => { releaseConnectors = resolve; });
  const started = new Promise<void>(resolve => { finishConnectors = resolve; });
  const store = makeStore();
  const result = await store.installPluginImport({ source: { provider: "claude", path: "/tmp/github" }, scope: "global", digest: preview.digest });
  let complete = false;
  const finishing = store.refreshPluginImport(result).then(() => { complete = true; });
  await started;
  expect(complete).toBe(false);
  expect(importWrites).toBe(1);
  releaseConnectors();
  await finishing;
  await store.refreshPluginImport(result);
  expect(importWrites).toBe(1);
  store.dispose();
});

test("missing imported skills reject completion, and retry updates the library without another import write", async () => {
  const store = makeStore();
  const result = await store.installPluginImport({ source: { provider: "claude", path: "/tmp/github" }, scope: "global", digest: preview.digest });
  imported = false;
  await expect(store.refreshPluginImport(result)).rejects.toThrow("The import was saved");
  imported = true;
  await store.refreshPluginImport(result);
  expect(store.skills().map(skill => skill.name)).toEqual(["github-review"]);
  expect(importWrites).toBe(1);
  store.dispose();
});
