import { expect, test } from "bun:test";
import { LawossViewTools } from "./lawoss-view-tools.js";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scopedWikiRuntime } from "../wiki/scoped-runtime.test-helper.js";
import type { ServerConfig } from "../types.js";

test("LAWOSS exposes the five local view tools without wiki tools or native file hooks", async () => {
  const plugin = await LawossViewTools();
  expect(Object.keys(plugin.tool).sort()).toEqual(["view_catalog", "view_create", "view_list", "view_read", "view_update"]);
  expect(Object.keys(plugin).sort()).toEqual(["chat.headers", "experimental.chat.system.transform", "tool"]);
  const output = { system: [] as string[] };
  await plugin["experimental.chat.system.transform"]({}, output);
  expect(output.system.join("\n")).toContain("queries: {}");
  expect(output.system.join("\n")).toContain("user chooses Save");
  const catalog = await plugin.tool.view_catalog!.execute({}, {});
  expect(String(catalog)).toContain("Stack");
});

test("workspace preview works through the real authenticated server; another client remains denied", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawoss-view-syn-"));
  const directory = join(root, "SYN-client"); await mkdir(directory);
  const other = join(root, "SYN-other"); await mkdir(other);
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "synthetic-client", hostToken: "synthetic-host",
    configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: [{ id: "syn", path: directory, name: "SYN Client", preset: "starter", workspaceType: "local" }, { id: "other", path: other, name: "SYN Other", preset: "starter", workspaceType: "local" }],
    authorizedRoots: [directory, other], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const runtime = await scopedWikiRuntime(config, "syn-session", directory);
  try {
    await runtime.run(async () => {
      const plugin = await LawossViewTools({ sessionID: "syn-session", directory });
      const input = { version: 1, title: "SYN report", mode: "report", catalog: "legalwork-1", program: 'root = Text("SYN overview")', queries: {} };
      const output = await plugin.tool.view_create!.execute({ input }, {});
      const preview = JSON.parse(typeof output === "string" ? output : output.output);
      expect(preview.status).toBe("preview");
      expect(preview.owner).toEqual({ kind: "workspace", id: "syn" });
      const deniedRaw = await plugin.tool.view_create!.execute({ owner: { kind: "workspace", id: "other" }, input }, {});
      const denied = JSON.parse(typeof deniedRaw === "string" ? deniedRaw : deniedRaw.output);
      expect(denied.ok).toBe(false);
      const listRaw = await plugin.tool.view_list!.execute({}, {});
      const list = JSON.parse(typeof listRaw === "string" ? listRaw : listRaw.output);
      expect(list.items).toEqual([]);
    });
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
});

test("wiki owners are rejected before any API request; scoped workspace errors stay errors", async () => {
  const plugin = await LawossViewTools();
  for (const tool of Object.values(plugin.tool)) {
    const raw = await tool.execute({ owner: { kind: "wiki", id: "private" } }, {});
    const result = JSON.parse(typeof raw === "string" ? raw : raw.output);
    expect(result.code).toBe("view_workspace_required");
  }
  const raw = await plugin.tool.view_list!.execute({}, {});
  const result = JSON.parse(typeof raw === "string" ? raw : raw.output);
  expect(result.ok).toBe(false);
});
