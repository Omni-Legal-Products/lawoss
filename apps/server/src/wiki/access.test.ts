import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "../types.js";
import type { WikiRegistration } from "@legalwork/types/wiki";
import { wikiAgentCanAccess } from "./access.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("project selection uses the most specific registered project and dedicated wiki scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "wiki-project-scope-")); roots.push(root);
  const parent = join(root, "project"), child = join(parent, "nested"), wikiRoot = join(root, "wiki"), other = join(root, "unregistered");
  await Promise.all([mkdir(child, { recursive: true }), mkdir(wikiRoot), mkdir(other)]);
  const wiki: WikiRegistration = { id: "wiki", name: "Knowledge", root: await realpath(wikiRoot), workspaceId: "wiki-workspace", sync: null,
    allowInProjects: true, projectWorkspaceIds: ["parent"] };
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "client", hostToken: "host", configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], authorizedRoots: [], readOnly: false,
    startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
    workspaces: [
      { id: "parent", name: "Parent", path: parent, preset: "starter", workspaceType: "local" },
      { id: "child", name: "Child", path: child, preset: "starter", workspaceType: "local" },
      { id: wiki.workspaceId, name: "Wiki", path: wiki.root, preset: "wiki", workspaceType: "local" },
    ],
  };
  expect(await wikiAgentCanAccess(config, [wiki], wiki, await realpath(parent))).toBe(true);
  expect(await wikiAgentCanAccess(config, [wiki], wiki, await realpath(child))).toBe(false);
  expect(await wikiAgentCanAccess(config, [wiki], wiki, await realpath(other))).toBe(false);
  wiki.projectWorkspaceIds = ["child"];
  expect(await wikiAgentCanAccess(config, [wiki], wiki, await realpath(child))).toBe(true);
  wiki.allowInProjects = false;
  expect(await wikiAgentCanAccess(config, [wiki], wiki, await realpath(child))).toBe(false);
  expect(await wikiAgentCanAccess(config, [wiki], wiki, wiki.root)).toBe(true);
  wiki.allowInProjects = true; wiki.projectWorkspaceIds = [];
  expect(await wikiAgentCanAccess(config, [wiki], wiki, await realpath(parent))).toBe(false);
  wiki.projectWorkspaceIds = null;
  expect(await wikiAgentCanAccess(config, [wiki], wiki, await realpath(child))).toBe(true);
});
