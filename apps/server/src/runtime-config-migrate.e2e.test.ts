import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
import { readGlobalMcpMap, readRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";

type Served = {
  port: number;
  stop: (closeActiveConnections?: boolean) => void | Promise<void>;
};

const CLIENT_TOKEN = "owt_runtime_migrate_client";
const HOST_TOKEN = "owt_runtime_migrate_host";
const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];
const priorDataDir = process.env.LEGALWORK_DATA_DIR;
const priorTokenStore = process.env.LEGALWORK_TOKEN_STORE;
const priorXdgConfigHome = process.env.XDG_CONFIG_HOME;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function clientAuth() {
  return { authorization: `Bearer ${CLIENT_TOKEN}`, "content-type": "application/json" };
}

async function createTempRoot(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function startLegalworkServer(workspaceRoot: string) {
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    configPath: join(workspaceRoot, "server.json"),
    token: CLIENT_TOKEN,
    hostToken: HOST_TOKEN,
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "Workspace", path: workspaceRoot, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [workspaceRoot],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config) as Served;
  stops.push(() => server.stop(true));
  return { base: `http://127.0.0.1:${server.port}`, config };
}

beforeEach(async () => {
  const envRoot = await createTempRoot("legalwork-runtime-migrate-env-");
  process.env.LEGALWORK_DATA_DIR = join(envRoot, "data");
  process.env.LEGALWORK_TOKEN_STORE = join(envRoot, "tokens.json");
  process.env.XDG_CONFIG_HOME = join(envRoot, "xdg");
});

afterEach(async () => {
  while (stops.length) {
    await stops.pop()?.();
  }
  while (roots.length) {
    await rm(roots.pop()!, { recursive: true, force: true });
  }
  if (priorDataDir === undefined) {
    delete process.env.LEGALWORK_DATA_DIR;
  } else {
    process.env.LEGALWORK_DATA_DIR = priorDataDir;
  }
  if (priorTokenStore === undefined) {
    delete process.env.LEGALWORK_TOKEN_STORE;
  } else {
    process.env.LEGALWORK_TOKEN_STORE = priorTokenStore;
  }
  if (priorXdgConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = priorXdgConfigHome;
  }
});

describe("runtime-config migrate route", () => {
  test("lifts MCP entries from project opencode.jsonc into the runtime store", async () => {
    const workspaceRoot = await createTempRoot("legalwork-runtime-migrate-");
    await writeFile(
      join(workspaceRoot, "opencode.jsonc"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        mcp: {
          "nova-mail": { type: "remote", url: "https://example.com/mcp/mail", enabled: true },
        },
      }, null, 2) + "\n",
      "utf8",
    );

    const { base, config } = await startLegalworkServer(workspaceRoot);

    const response = await fetch(`${base}/workspace/ws_1/runtime-config/migrate`, {
      method: "POST",
      headers: clientAuth(),
    });
    expect(response.status).toBe(200);

    const body = asRecord(await response.json());
    expect(body.migrated).toBe(true);
    expect(Array.isArray(body.userOpencodeKeys) && body.userOpencodeKeys.includes("mcp")).toBe(true);

    // Connectors are shared by every workspace: the migrated MCP lands in the
    // shared row, not in this workspace's own.
    expect((await readGlobalMcpMap(config))["nova-mail"]?.url).toBe("https://example.com/mcp/mail");
    expect((await readRuntimeOpencodeConfig(config, "ws_1")).mcp?.["nova-mail"]).toBeUndefined();

    const parsed = asRecord(JSON.parse(await readFile(join(workspaceRoot, "opencode.jsonc"), "utf8")));
    expect(parsed.mcp).toBeUndefined();
  });

  test("preserves the effective global-project connector set and full v2 fields without restoring OAuth", async () => {
    const workspaceRoot = await createTempRoot("legalwork-runtime-migrate-effective-");
    const globalDir = join(process.env.XDG_CONFIG_HOME!, "opencode");
    await mkdir(globalDir, { recursive: true });
    await writeFile(join(globalDir, "opencode.jsonc"), JSON.stringify({
      mcp: {
        shadowed: { type: "remote", url: "https://global.example.test/mcp", enabled: false },
        "global-only": { type: "remote", url: "https://global-only.example.test/mcp", oauth: false },
      },
    }, null, 2) + "\n", "utf8");
    await writeFile(join(workspaceRoot, "opencode.jsonc"), JSON.stringify({
      tools: { deny: ["mcp.shadowed"] },
      mcp: {
        shadowed: {
          type: "remote",
          url: "https://project.example.test/mcp",
          enabled: true,
          headers: { Authorization: "Bearer synthetic" },
          oauth: {
            clientId: "synthetic-client",
            clientSecret: "synthetic-secret",
            scope: "files.read",
            callbackPort: 43123,
            redirectUri: "http://127.0.0.1:43123/callback",
          },
          timeout: 7_500,
        },
        "local-full": {
          type: "local",
          command: ["bunx", "synthetic-mcp"],
          cwd: "/synthetic/workspace",
          environment: { MODE: "test" },
          enabled: false,
          timeout: 5_000,
        },
      },
    }, null, 2) + "\n", "utf8");

    const { base } = await startLegalworkServer(workspaceRoot);
    const list = async () => {
      const response = await fetch(`${base}/workspace/ws_1/mcp`, { headers: clientAuth() });
      expect(response.status).toBe(200);
      return (await response.json() as { items: Array<Record<string, unknown>> }).items;
    };

    const before = await list();
    expect(before.map((item) => [item.name, item.source])).toEqual([
      ["global-only", "config.global"],
      ["shadowed", "config.project"],
      ["local-full", "config.project"],
    ]);
    expect(before.find((item) => item.name === "shadowed")).toMatchObject({
      disabledByTools: true,
      config: {
        url: "https://project.example.test/mcp",
        oauth: { callbackPort: 43123, redirectUri: "http://127.0.0.1:43123/callback" },
      },
    });

    const migration = await fetch(`${base}/workspace/ws_1/runtime-config/migrate`, {
      method: "POST",
      headers: clientAuth(),
    });
    expect(migration.status).toBe(200);

    const after = await list();
    expect(after.map((item) => [item.name, item.source])).toEqual([
      ["global-only", "config.global"],
      ["shadowed", "config.remote"],
      ["local-full", "config.remote"],
    ]);
    expect(after.find((item) => item.name === "shadowed")).toEqual(before.find((item) => item.name === "shadowed") && {
      ...before.find((item) => item.name === "shadowed"),
      source: "config.remote",
    });
    expect(after.find((item) => item.name === "local-full")).toMatchObject({
      config: {
        command: ["bunx", "synthetic-mcp"],
        cwd: "/synthetic/workspace",
        environment: { MODE: "test" },
        enabled: false,
        timeout: 5_000,
      },
    });
    const shadowed = after.find((item) => item.name === "shadowed")!;
    expect(shadowed).not.toHaveProperty("oauthStatus");
    expect(JSON.stringify(shadowed)).not.toContain("accessToken");
    expect(JSON.stringify(shadowed)).not.toContain("refreshToken");
  });
});
