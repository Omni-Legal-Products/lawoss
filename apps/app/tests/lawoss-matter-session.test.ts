import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { buildOverview } from "../../../lawoss/okf/read";
import { openMatterSession, resolveDiscoveredMatter } from "../src/lawoss/okf/matter-session";
import { getSessionDraft, saveSessionDraft } from "../src/react-app/domains/session/sync/draft-store";
import { readActiveWorkspaceId, readLastSessionFor } from "../src/react-app/shell/session-memory";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";
import { memoryFixture } from "./lawoss-memory-fixture";

const cleanups: (() => Promise<void>)[] = [];
const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow); else Reflect.deleteProperty(globalThis, "window"); });
const matters = () => buildOverview([{ path: "AK/S/A/Spisy/A", cardFrontmatter: { title: "Rovnaký názov", spisova_znacka: "CASE-A" }, records: [] }, { path: "AK/S/B/Spisy/B", cardFrontmatter: { title: "Rovnaký názov", spisova_znacka: "CASE-B" }, records: [] }], "2026-09-21").matters;
const office: RouteWorkspace = { id: "office", path: "/office", name: "Office", displayNameResolved: "Office", workspaceType: "local" };

test("discovered selection uses path identity and rejects URL copies, ambiguous and injected records", () => {
  const records = matters(); expect(resolveDiscoveredMatter(office, records[0]!, records).parts).toEqual(["AK", "S", "A", "Spisy", "A"]);
  expect(() => resolveDiscoveredMatter(office, { ...records[0]! }, records)).toThrow("prehľadu");
  expect(() => resolveDiscoveredMatter(office, records[0]!, [...records, { ...records[0]! }])).toThrow("nejednoznačný");
  for (const path of ["../other", "/absolute", "A/../other", "A\\other", "A/%2fother", "A?directory=/outside", "C:/outside", "A//B", "A/.", "A\0B"]) {
    const bad = { ...records[0]!, path }; expect(() => resolveDiscoveredMatter(office, bad, [bad])).toThrow();
  }
  expect(() => resolveDiscoveredMatter(null, records[0]!, records)).toThrow();
  expect(() => resolveDiscoveredMatter({ ...office, workspaceType: "remote" }, records[0]!, records)).toThrow();
});

test("production matter orchestration supports native engine startup and creates exactly one scoped child session", async () => {
  const f = await memoryFixture(); cleanups.push(f.cleanup);
  f.config.workspaces = f.config.workspaces.filter(workspace => workspace.id === "office");
  const started: unknown[] = [];
  const selected: { command: string; id: unknown }[] = [];
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } },
    dispatchEvent: () => true,
    __LEGALWORK_ELECTRON__: { invokeDesktop: async (command: string, ...args: unknown[]) => {
      if (command === "__joinPath") return join(...args.filter((part): part is string => typeof part === "string"));
      if (command === "engineInfo") return { running: false, baseUrl: f.engineUrl };
      if (command === "engineStart") { started.push(args[0]); return { running: true, baseUrl: f.engineUrl }; }
      if (command === "legalworkServerInfo") return { baseUrl: f.baseUrl, ownerToken: "synthetic-client", hostToken: "synthetic-host" };
      if (command === "workspaceSetSelected" || command === "workspaceSetRuntimeActive") { selected.push({ command, id: args[0] }); return {}; }
      throw new Error(`Unexpected desktop call ${command}`);
    } },
  } });
  const records = matters(), workspace = { ...office, path: f.root };
  const connection = { client: f.client, baseUrl: f.baseUrl, token: "synthetic-client", workspaces: [workspace], activeWorkspaceId: "office" };
  saveSessionDraft("office", "existing-office-session", { text: "untouched office draft", mode: "prompt" });
  const route = await openMatterSession(connection, workspace, records[0]!, records);
  const child = f.config.workspaces.find(w => w.path === f.matter && w.id !== "matter");
  expect(child).toBeDefined();
  expect(started).toEqual([f.matter]);
  expect(route).toBe(`/workspace/${child!.id}/session/synthetic-session`);
  expect(selected).toEqual([{ command: "workspaceSetSelected", id: child!.id }, { command: "workspaceSetRuntimeActive", id: child!.id }]);
  expect(readActiveWorkspaceId()).toBe(child!.id); expect(readLastSessionFor(child!.id)).toBe("synthetic-session");
  expect(f.engineCalls.filter(call => call.path === "/session" && call.method === "POST")).toEqual([{ method: "POST", path: "/session", directory: f.matter }]);
  expect(getSessionDraft(child!.id, "synthetic-session").text).toContain(f.matter);
  expect(getSessionDraft(child!.id, "synthetic-session").text).toContain("CASE-A");
  expect(getSessionDraft("office", "existing-office-session").text).toBe("untouched office draft");
  f.config.readOnly = true;
  await expect(openMatterSession(connection, workspace, records[1]!, records)).rejects.toThrow("iba čítanie");
  expect(f.engineCalls.filter(call => call.path === "/session" && call.method === "POST")).toHaveLength(1);
});
