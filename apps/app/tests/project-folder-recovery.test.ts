import { expect, test } from "bun:test";
import type { LegalworkWorkspaceInfo } from "../src/app/lib/legalwork-server";
const workspace: LegalworkWorkspaceInfo = { id: "same", name: "Matter", path: "/new", preset: "starter", workspaceType: "local" };
import { recoverProjectFolder } from "../src/react-app/domains/workspace/project-folder-recovery";
test("cancel does not reconnect, activate or refresh", async () => {
  const calls: string[] = [];
  const client = { reconnectWorkspace: async () => { calls.push("reconnect"); return { workspace, persisted: true as const }; }, activateWorkspace: async () => { calls.push("activate"); return { activeId: "same", workspace, persisted: true }; } };
  expect(await recoverProjectFolder({ client, workspaceId: "same", expectedPath: "/old", pick: async () => null, refresh: async () => { calls.push("refresh"); } })).toBe(false); expect(calls).toEqual([]);
});
test("recovery carries original ID and path then activates and refreshes", async () => {
  const calls: unknown[] = [];
  const client = { reconnectWorkspace: async (id: string, payload: unknown) => { calls.push([id, payload]); return { workspace, persisted: true as const }; }, activateWorkspace: async (id: string) => { calls.push(id); return { activeId: "same", workspace, persisted: true }; } };
  expect(await recoverProjectFolder({ client, workspaceId: "same", expectedPath: "/old", pick: async () => "/new", refresh: async () => { calls.push("refresh"); } })).toBe(true);
  expect(calls).toEqual([["same", { folderPath: "/new", expectedPath: "/old" }], "same", "refresh"]);
});
test("failed reconnect preserves error and never activates or refreshes", async () => {
  const failure = new Error("Persistence failed"); const calls: string[] = [];
  const client = { reconnectWorkspace: async () => { throw failure; }, activateWorkspace: async () => { calls.push("activate"); return { activeId: "same", workspace, persisted: true }; } };
  await expect(recoverProjectFolder({ client, workspaceId: "same", expectedPath: "/old", pick: async () => "/new", refresh: async () => { calls.push("refresh"); } })).rejects.toBe(failure); expect(calls).toEqual([]);
});
