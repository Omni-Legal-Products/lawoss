import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NovySpisPanel } from "../src/lawoss/domains/novy-spis/novy-spis-page";
import { prepareOkfDraft, okfTargetWithinWorkspace } from "../src/lawoss/domains/novy-spis/prepare-draft";
import type { LegalworkServerClient } from "../src/app/lib/legalwork-server";

const workspace = { id: "local-one", name: "Moje spisy", displayNameResolved: "Moje spisy", path: "/office", workspaceType: "local" as const };

test("shared panel uses supplied workspace, without experimental navigation or a creation claim", () => {
  const html = renderToStaticMarkup(<NovySpisPanel connection={{ client: null, baseUrl: "", token: "" }} workspace={workspace} onOpenSession={() => {}} />);
  expect(html).toContain("Moje spisy");
  expect(html).toContain("Názov priečinka");
  expect(html).toContain("Pripraviť návrh rozhovoru");
  expect(html).not.toContain('aria-label="Experimenty"');
  expect(html).not.toContain("Potvrdiť vytvorenie");
});

function clientFor(writable: boolean, calls: string[], failResource = false): Pick<LegalworkServerClient, "capabilities" | "upsertSkill" | "upsertSkillResource"> {
  return {
    capabilities: async () => ({ skills: { read: true, write: writable, source: "legalwork" }, skillResources: { read: true, write: writable }, plugins: { read: true, write: writable }, mcp: { read: true, write: writable }, commands: { read: true, write: writable }, config: { read: true, write: writable } }),
    upsertSkill: async (id: string) => { calls.push(`skill:${id}`); return { name: "skill", path: "/skill", description: "", scope: "project" }; },
    upsertSkillResource: async (id: string) => { calls.push(`resource:${id}`); if (failResource) throw new Error("resource denied"); return { ok: true, name: "resource", path: "/resource", action: "added" }; },
  };
}

test("read-only permission prevents every mutation and draft creation", async () => {
  const calls: string[] = [];
  await expect(prepareOkfDraft(clientFor(false, calls), workspace, async () => { calls.push("draft"); return "/session"; })).rejects.toThrow("zápis");
  expect(calls).toEqual([]);
});

test("writes only the selected workspace resources, then opens a draft without registering a folder", async () => {
  const calls: string[] = [];
  expect(await prepareOkfDraft(clientFor(true, calls), workspace, async () => { calls.push("draft"); return "/session"; })).toBe("/session");
  expect(calls).toEqual(["skill:local-one", "resource:local-one", "skill:local-one", "resource:local-one", "draft"]);
});

test("failed skill resource write cannot open a misleading ready draft", async () => {
  const calls: string[] = [];
  await expect(prepareOkfDraft(clientFor(true, calls, true), workspace, async () => { calls.push("draft"); return "/session"; })).rejects.toThrow("resource denied");
  expect(calls).toEqual(["skill:local-one", "resource:local-one"]);
});

test("remote workspace is rejected before capability checks or writes", async () => {
  const calls: string[] = [];
  await expect(prepareOkfDraft(clientFor(true, calls), { ...workspace, workspaceType: "remote" }, async () => "/session")).rejects.toThrow("lokálny");
  expect(calls).toEqual([]);
});

test("native target scope rejects sibling and traversal paths, and accepts a workspace subfolder", () => {
  expect(okfTargetWithinWorkspace("/office/client", workspace)).toBe(true);
  expect(okfTargetWithinWorkspace("/office/sub/client", workspace)).toBe(true);
  expect(okfTargetWithinWorkspace("/office-other/client", workspace)).toBe(false);
  expect(okfTargetWithinWorkspace("/elsewhere/client", workspace)).toBe(false);
  expect(okfTargetWithinWorkspace("/office/../elsewhere/client", workspace)).toBe(false);
  expect(okfTargetWithinWorkspace("C:\\office\\sub/client", { ...workspace, path: "C:\\office" })).toBe(true);
});
