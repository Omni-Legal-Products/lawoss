import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StoredViewSchema, type ViewInput } from "@legalwork/types/views";
import type { ServerConfig } from "../types.js";
import { ViewRepository, workspaceViewFiles } from "./repository.js";
import { recordViewSaveSource, viewSaveSource, withViewSaveSources } from "./save-source.js";
import { reviewSessionViews } from "./session-previews.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "view-source-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const input: ViewInput = { version: 1, title: "Report", mode: "report", catalog: "legalwork-1", program: 'root = Text("Evidence")', queries: {} };
const source = { workspaceId: "private-project", sessionId: "private-chat", callId: "private-call" };
const config = (): ServerConfig => ({ host: "localhost", port: 0, token: "test", hostToken: "host", configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false, startedAt: 0, tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false });

test("local receipts survive reopening, but never enter shared view files or responses", async () => {
  const repo = new ViewRepository({ kind: "workspace", id: "project" }, workspaceViewFiles(root));
  const view = await repo.create(input);
  await recordViewSaveSource(config(), view, source);
  const bytes = await readFile(join(root, await repo.location(view.id)), "utf8");
  expect(StoredViewSchema.parse(JSON.parse(bytes))).not.toHaveProperty("savedFrom");
  expect(bytes).not.toContain(source.sessionId);
  expect(await repo.read(view.id)).not.toHaveProperty("savedFrom");
  const saved = await withViewSaveSources(config(), [await repo.read(view.id)]);
  expect(saved[0].savedFrom).toEqual(source);
  // Truncated legacy previews still have positive proof of an explicit save.
  const items = [{ callId: source.callId, title: input.title }];
  expect(reviewSessionViews(items, saved, source.workspaceId, source.sessionId).items).toEqual([]);
  const edited = await repo.update(view.id, { ...input, title: "Changed elsewhere" }, view.revision);
  expect((await withViewSaveSources(config(), [edited]))[0]).not.toHaveProperty("savedFrom");
  expect(reviewSessionViews(items, await withViewSaveSources(config(), []), source.workspaceId, source.sessionId).items).toHaveLength(1);
});

test("early preview-build files remain readable and lose legacy receipt metadata on next save", async () => {
  const repo = new ViewRepository({ kind: "workspace", id: "project" }, workspaceViewFiles(root));
  const view = await repo.create(input), path = join(root, await repo.location(view.id));
  const raw = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...raw, savedFrom: source }));
  const legacy = await repo.read(view.id);
  expect(legacy).not.toHaveProperty("savedFrom");
  await repo.update(view.id, input, legacy.revision);
  expect(await readFile(path, "utf8")).not.toContain("savedFrom");
});

test("optional provenance transport is validated independently of the v1 view body", () => {
  expect(viewSaveSource(new Request("http://localhost"))).toBeUndefined();
  expect(viewSaveSource(new Request(`http://localhost?source=${encodeURIComponent(JSON.stringify(source))}`))).toEqual(source);
  expect(() => viewSaveSource(new Request("http://localhost?source=broken"))).toThrow();
});


test("query provenance works without new CORS headers and receipt failure does not turn a saved file into an error", async () => {
  expect(viewSaveSource(new Request(`http://localhost/ui-views?source=${encodeURIComponent(JSON.stringify(source))}`))).toEqual(source);
  const repo = new ViewRepository({ kind: "workspace", id: "project" }, workspaceViewFiles(root));
  const view = await repo.create(input);
  await writeFile(join(root, "blocked"), "not a directory");
  const unavailable = { ...config(), configPath: join(root, "blocked", "server.json") };
  await expect(recordViewSaveSource(unavailable, view, source)).resolves.toBeUndefined();
  expect(await withViewSaveSources(unavailable, [await repo.read(view.id)])).toEqual([view]);
});
