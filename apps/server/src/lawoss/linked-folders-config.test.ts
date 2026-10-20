// LAWOSS: pripojené priečinky klienta (MČ 19. 10. 2026) idú cez natívne povolené priečinky
// (`permission.external_directory` riadku klienta). Test na úrovni konfigurácie: čo z natívneho zápisu
// dostane engine, pre ktorého klienta a že iný klient to nevidí.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildLegalworkRuntimeConfigObject, legalworkRuntimeConfigFilePath, writeLegalworkRuntimeConfigFile } from "../legalwork-runtime-config.js";
import { readRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";

const CLIENT_TOKEN = "owt_linked_folders_client";
const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];
const prior = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE, db: process.env.LEGALWORK_RUNTIME_DB };

const restore = (key: "LEGALWORK_DATA_DIR" | "LEGALWORK_TOKEN_STORE" | "LEGALWORK_RUNTIME_DB", value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

beforeEach(async () => {
  const env = await realpath(await mkdtemp(join(tmpdir(), "lawoss-linked-env-")));
  roots.push(env);
  process.env.LEGALWORK_DATA_DIR = join(env, "data");
  process.env.LEGALWORK_TOKEN_STORE = join(env, "tokens.json");
  process.env.LEGALWORK_RUNTIME_DB = join(env, "runtime.sqlite");
});

afterEach(async () => {
  try {
    while (stops.length) await stops.pop()?.();
    while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
  } finally {
    restore("LEGALWORK_DATA_DIR", prior.data);
    restore("LEGALWORK_TOKEN_STORE", prior.tokens);
    restore("LEGALWORK_RUNTIME_DB", prior.db);
  }
});

async function practice() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-linked-")));
  roots.push(root);
  const client = join(root, "prax", "Klienti", "Tatran");
  const other = join(root, "prax", "Klienti", "Hron");
  const linked = join(root, "Zdieľané", "Vzory zmlúv");
  for (const folder of [join(client, "Spisy", "Uhrada"), other, join(linked, "Rok 2026")]) await mkdir(folder, { recursive: true });
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, configPath: join(root, "server.json"), token: CLIENT_TOKEN, hostToken: "owt_linked_folders_host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"],
    workspaces: [
      { id: "ws_client", name: "Tatran", path: client, preset: "starter", workspaceType: "local" },
      { id: "ws_other", name: "Hron", path: other, preset: "starter", workspaceType: "local" },
    ],
    authorizedRoots: [client, other], readOnly: false, startedAt: Date.now(),
    tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const server = await startServer(config);
  stops.push(() => server.stop());
  const put = (workspaceId: string, folders: string[]) => fetch(`http://127.0.0.1:${server.port}/workspace/${workspaceId}/authorized-folders`, {
    method: "PUT", headers: { authorization: `Bearer ${CLIENT_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ folders }),
  });
  return { config, client, other, linked, put };
}

const externalDirectory = (built: Record<string, unknown>): Record<string, unknown> => {
  const permission = built.permission;
  if (!permission || typeof permission !== "object" || Array.isArray(permission)) return {};
  const value = "external_directory" in permission ? permission.external_directory : undefined;
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
};

describe("pripojené priečinky klienta: konfigurácia enginu", () => {
  test("natívny zápis klienta sa dostane do oprávnení enginu len pre tohto klienta", async () => {
    const { config, linked, put } = await practice();
    const response = await put("ws_client", [linked]);
    expect(response.status).toBe(200);
    expect((await response.json() as { folders: string[] }).folders).toEqual([linked]);

    // Celý priečinok aj jeho podpriečinky: vzor „<priečinok>/*“ s „allow“ (jediná úroveň natívneho mechanizmu).
    expect(externalDirectory(await buildLegalworkRuntimeConfigObject(config, "ws_client"))).toEqual({ [`${linked}/*`]: "allow" });
    // Iný klient (iný riadok) pripojený priečinok nedostane.
    expect(externalDirectory(await buildLegalworkRuntimeConfigObject(config, "ws_other"))).toEqual({});
  });

  test("súbor pre engine je jeden pre všetky priečinky chatov klienta (koreň aj vec); nesie pripojený priečinok", async () => {
    const { config, linked, put } = await practice();
    expect((await put("ws_client", [linked])).status).toBe(200);
    const path = await writeLegalworkRuntimeConfigFile(config, "ws_client");
    expect(path).toBe(legalworkRuntimeConfigFilePath(config));
    const file: unknown = JSON.parse(await readFile(path, "utf8"));
    expect(file && typeof file === "object" && !Array.isArray(file) ? externalDirectory({ ...file }) : {}).toEqual({ [`${linked}/*`]: "allow" });
  });

  test("odpojenie cez natívny zápis zachová položky, ktoré zoznam neukazuje (napr. odmietnutia)", async () => {
    const { config, linked, put } = await practice();
    await writeRuntimeOpencodeConfig(config, "ws_client", (current) => ({
      ...current, permission: { ...current.permission, external_directory: { "/denied/*": "deny", [`${linked}/*`]: "allow" } },
    }));
    expect((await put("ws_client", [])).status).toBe(200);
    expect((await readRuntimeOpencodeConfig(config, "ws_client")).permission?.external_directory).toEqual({ "/denied/*": "deny" });
  });
});
