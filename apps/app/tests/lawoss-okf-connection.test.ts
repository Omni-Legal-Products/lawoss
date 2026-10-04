// okf/connection.ts: spojenie mimo session-route (desktop bridge + server) a založenie konverzácie s konceptom.
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { loadOkfConnection, openSessionWithPrompt } from "../src/lawoss/okf/connection";
import { getSessionDraft } from "../src/react-app/domains/session/sync/draft-store";
import { getComposerDraft, useComposerStateStore } from "../src/react-app/domains/session/surface/composer-state-store";
import { readLastSessionFor } from "../src/react-app/shell/session-memory";
import { memoryFixture } from "./lawoss-memory-fixture";

const cleanups: (() => Promise<void>)[] = [];
const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow); else Reflect.deleteProperty(globalThis, "window");
});

type Bridge = { bootstrap: () => unknown; server: () => unknown };
function desktop(bridge: Bridge) {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } },
    dispatchEvent: () => true,
    __LEGALWORK_ELECTRON__: { invokeDesktop: async (command: string, ...args: unknown[]) => {
      if (command === "__joinPath") return join(...args.filter((part): part is string => typeof part === "string"));
      if (command === "workspaceBootstrap") return bridge.bootstrap();
      if (command === "legalworkServerInfo") return bridge.server();
      throw new Error(`Unexpected desktop call ${command}`);
    } },
  } });
}

test("loads server workspaces with the desktop token; a failed bridge bootstrap does not block the server list", async () => {
  const f = await memoryFixture(); cleanups.push(f.cleanup);
  const server = () => ({ running: true, baseUrl: f.baseUrl, ownerToken: "synthetic-client", hostToken: "synthetic-host" });
  desktop({ bootstrap: () => ({ workspaces: [{ id: "office", path: f.root, name: "Office", preset: "starter", workspaceType: "local" }] }), server });
  const connection = await loadOkfConnection();
  expect(connection.client).not.toBeNull();
  expect(connection).toMatchObject({ baseUrl: f.baseUrl, token: "synthetic-client", activeWorkspaceId: "office" });
  expect(connection.workspaces.map((w) => w.id).sort()).toEqual(["matter", "office"]);

  desktop({ bootstrap: () => { throw new Error("bridge down"); }, server });
  expect((await loadOkfConnection()).workspaces.map((w) => w.id).sort()).toEqual(["matter", "office"]);
});

test("without a usable server it keeps the desktop workspaces and has no client", async () => {
  desktop({ bootstrap: () => ({ workspaces: [{ id: "local", path: "/synthetic", name: "Local", preset: "starter", workspaceType: "local" }] }), server: () => ({ running: false }) });
  const connection = await loadOkfConnection();
  expect(connection).toMatchObject({ client: null, baseUrl: "", token: "", activeWorkspaceId: "" });
  expect(connection.workspaces.map((w) => w.id)).toEqual(["local"]);
});

test("opens a session with the prompt as draft in both stores; a remote workspace without an address fails before any call", async () => {
  const f = await memoryFixture(); cleanups.push(f.cleanup);
  desktop({ bootstrap: () => ({ workspaces: [] }), server: () => ({ running: false }) });
  const workspace = { id: "office", path: f.root, name: "Office", displayNameResolved: "Office", workspaceType: "local" as const };
  const connection = { client: f.client, baseUrl: f.baseUrl, token: "synthetic-client", workspaces: [workspace], activeWorkspaceId: "office" };
  const route = await openSessionWithPrompt(connection, workspace, "Syntetický koncept");
  expect(route).toBe("/workspace/office/session/synthetic-session");
  expect(getSessionDraft("office", "synthetic-session").text).toBe("Syntetický koncept");
  expect(getComposerDraft(useComposerStateStore.getState(), "synthetic-session")).toBe("Syntetický koncept");
  expect(readLastSessionFor("office")).toBe("synthetic-session");
  expect(f.engineCalls.filter((c) => c.path === "/session" && c.method === "POST")).toEqual([{ method: "POST", path: "/session", directory: f.root }]);

  const before = f.engineCalls.length;
  await expect(openSessionWithPrompt(connection, { ...workspace, id: "rem_office", workspaceType: "remote" }, "x")).rejects.toThrow();
  expect(f.engineCalls).toHaveLength(before);
});
