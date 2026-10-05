import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fetchEigenweltManifest, parseEigenweltEntitlements } from "../eigenwelt-auth.js";
import { readEigenweltConnection, writeEigenweltConnection } from "../eigenwelt-connection-store.js";
import { readCachedEigenweltPaidManifest, refreshEigenweltPaidManifest, writeCachedEigenweltPaidManifest } from "../eigenwelt-paid-manifest.js";
import { ensureFreshPlatformToken } from "../eigenwelt-refresh.js";
import { legalworkRuntimeConfigFilePath, writeLegalworkRuntimeConfigFile } from "../legalwork-runtime-config.js";
import { writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { EIGENWELT_ACCOUNT_ENV, eigenweltAccountEnabled } from "./commercial-services.js";

const preloaded = process.env[EIGENWELT_ACCOUNT_ENV];
const previousDb = process.env.LEGALWORK_RUNTIME_DB;
const originalFetch = globalThis.fetch;
const roots: string[] = [];
const requests: string[] = [];

afterEach(async () => {
  if (preloaded === undefined) delete process.env[EIGENWELT_ACCOUNT_ENV];
  else process.env[EIGENWELT_ACCOUNT_ENV] = preloaded;
  if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB;
  else process.env.LEGALWORK_RUNTIME_DB = previousDb;
  globalThis.fetch = originalFetch;
  requests.length = 0;
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

/** Stav, ktorý by zostal po prihlásení do Eigenweltu v inštalácii LegalWorku. */
async function leftoverSignedInState(): Promise<ServerConfig> {
  const root = await mkdtemp(join(tmpdir(), "lawoss-eigenwelt-account-"));
  roots.push(root);
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "owt_test_token",
    hostToken: "owt_host_token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "Spis", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  process.env[EIGENWELT_ACCOUNT_ENV] = "1";
  await writeCachedEigenweltPaidManifest(config, {
    baseURL: "https://paid.gateway.test/v1",
    apiKey: "sk-firm-key",
    models: [{ id: "Eigenwelt Europe" }],
  });
  await writeEigenweltConnection(config, {
    platformToken: "access",
    refreshToken: "refresh",
    accessTokenExpiresAt: Date.now() - 1000,
    entitlements: parseEigenweltEntitlements({ plan: "plus", features: ["premium_models"] }) ?? null,
  });
  // Starý blok poskytovateľa uložený v spise (cesta „Vložiť API kľúč“).
  await writeRuntimeOpencodeConfig(config, "ws_1", (current) => ({
    ...current,
    provider: { eigenwelt: { npm: "@ai-sdk/openai-compatible", name: "Eigenwelt", options: { baseURL: "https://paid.gateway.test/v1" }, models: { a: { name: "A" } } } },
  }));
  delete process.env[EIGENWELT_ACCOUNT_ENV];
  globalThis.fetch = (async (input: unknown) => {
    requests.push(String(input));
    return new Response("{}", { status: 500 });
  }) as typeof fetch;
  return config;
}

describe("LAWOSS: účet Eigenwelt je vypnutý", () => {
  test("predvolene vypnutý, zapína ho len premenná prostredia", () => {
    expect(eigenweltAccountEnabled({})).toBe(false);
    expect(eigenweltAccountEnabled({ [EIGENWELT_ACCOUNT_ENV]: "1" })).toBe(true);
  });

  test("uložené prihlásenie z LegalWorku sa nečíta a token sa neobnovuje", async () => {
    const config = await leftoverSignedInState();
    const connection = await readEigenweltConnection(config);
    expect(connection.refreshToken).toBeNull();
    expect(connection.entitlements).toBeNull();
    expect(await ensureFreshPlatformToken(config)).toBeNull();
    expect(requests).toEqual([]);
  });

  test("platený manifest sa nečíta ani neobnovuje a manifest sa nesťahuje", async () => {
    const config = await leftoverSignedInState();
    expect(await readCachedEigenweltPaidManifest(config)).toBeNull();
    expect(await refreshEigenweltPaidManifest(config, { platformToken: null })).toEqual({ modelCount: 0, changed: false });
    await expect(fetchEigenweltManifest()).rejects.toThrow("not available in LAWOSS");
    expect(requests).toEqual([]);
  });

  test("engine nedostane poskytovateľa Eigenwelt ani zo starej konfigurácie spisu", async () => {
    const config = await leftoverSignedInState();
    await writeLegalworkRuntimeConfigFile(config, "ws_1");
    const engineConfig = JSON.parse(await readFile(legalworkRuntimeConfigFilePath(config), "utf8")) as {
      disabled_providers?: string[];
      provider?: Record<string, unknown>;
    };
    expect(engineConfig.disabled_providers).toContain("eigenwelt");
    expect(JSON.stringify(engineConfig.provider ?? {})).not.toContain("sk-firm-key");
    expect(requests).toEqual([]);
  });
});
