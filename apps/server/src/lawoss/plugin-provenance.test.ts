import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCloudPlugin, readInstalledCloudPlugins, type CloudPluginResolved } from "../cloud-plugins.js";
import type { ServerConfig } from "../types.js";
import { contentSha256, readProvenance } from "./plugin-provenance.js";
import { removeTestDir } from "./test-support/remove-test-dir.js";

const WORKSPACE_ID = "ws_lawoss_provenance";

function serverConfig(root: string): ServerConfig {
  return {
    host: "127.0.0.1", port: 0, token: "token", hostToken: "host-token", configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [],
    workspaces: [{ id: WORKSPACE_ID, name: "Test", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated",
    logFormat: "pretty", logRequests: false,
  } satisfies ServerConfig;
}

const resolved: CloudPluginResolved = {
  plugin: { id: "github:Omni-Legal-Products/lawoss-marketplace#plugins/orsr", name: "orsr", description: "ORSR", updatedAt: null },
  memberships: [{
    configObjectId: "skill_1",
    configObject: {
      id: "skill_1", objectType: "skill", title: "orsr-obchodny-register", description: "Obchodný register",
      currentRelativePath: null, status: "active", updatedAt: null,
      latestVersion: { id: "blob_1", rawSourceText: "# ORSR\n\nVymyslený obsah testu.", normalizedPayloadJson: null },
    },
  }],
};

describe("LAWOSS: pôvod nainštalovaného pluginu", () => {
  test("inštalácia z GitHubu zapíše repozitár, SHA, verziu a hash zapísaného SKILL.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "lawoss-provenance-"));
    const previousDb = process.env.LEGALWORK_RUNTIME_DB;
    process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    try {
      const config = serverConfig(root);
      const source = { owner: "Omni-Legal-Products", repo: "lawoss-marketplace", ref: "deff09cf87c6e81bfbeebadf675a67b698920be6", dir: "plugins/orsr" };
      const imported = await installCloudPlugin({
        serverConfig: config, workspaceId: WORKSPACE_ID, workspaceRoot: root, marketplaceId: null, resolved,
        provenance: { source, version: "1.1.0" },
      });
      expect(imported.provenance).toEqual({ source, version: "1.1.0" });
      const skill = imported.files.find((file) => file.objectType === "skill")!;
      const written = await readFile(join(root, skill.path), "utf8");
      expect(skill.contentSha256).toBe(contentSha256(written));
      expect(skill.versionId).toBe("blob_1");

      const stored = await readInstalledCloudPlugins(config, WORKSPACE_ID);
      expect(stored.plugins[resolved.plugin.id]?.provenance).toEqual({ source, version: "1.1.0" });
      expect(stored.plugins[resolved.plugin.id]?.files[0]?.contentSha256).toBe(contentSha256(written));

      // Inštalácia bez pôvodu (firemný marketplace) pole nezapíše.
      const again = await installCloudPlugin({ serverConfig: config, workspaceId: WORKSPACE_ID, workspaceRoot: root, marketplaceId: null, resolved });
      expect("provenance" in again).toBe(false);
    } finally {
      if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB;
      else process.env.LEGALWORK_RUNTIME_DB = previousDb;
      await removeTestDir(root);
    }
  });

  test("poškodený alebo neúplný pôvod sa pri čítaní vynechá", () => {
    expect(readProvenance({})).toEqual({});
    expect(readProvenance({ provenance: { source: { owner: "a", repo: "b" } } })).toEqual({});
    expect(readProvenance({ provenance: { source: { owner: "a", repo: "b", ref: "c", dir: 3 }, version: 1 } }))
      .toEqual({ provenance: { source: { owner: "a", repo: "b", ref: "c", dir: null }, version: null } });
  });
});
