import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.js";
import { GLOBAL_PROVIDERS_ID, readRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import { readLegalworkWorkspaceConfig, writeLegalworkWorkspaceConfig } from "./legalwork-workspace-config-store.js";
import { createCustomProviderModelRefresh } from "./custom-provider-model-refresh.js";
import type { ServerConfig } from "./types.js";
import { removeTestDir } from "./lawoss/test-support/remove-test-dir.js";

const previous = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE, db: process.env.LEGALWORK_RUNTIME_DB };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const [key, value] of Object.entries({ LEGALWORK_DATA_DIR: previous.data, LEGALWORK_TOKEN_STORE: previous.tokens, LEGALWORK_RUNTIME_DB: previous.db })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-global-providers-")));
  cleanups.push(() => removeTestDir(base));
  const office = join(base, "office");
  await mkdir(office, { recursive: true });
  const second = join(base, "second");
  await mkdir(second, { recursive: true });
  process.env.LEGALWORK_DATA_DIR = join(base, "data");
  process.env.LEGALWORK_TOKEN_STORE = join(base, "tokens.json");
  process.env.LEGALWORK_RUNTIME_DB = join(base, "runtime.sqlite");
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(base, "server.json"), token: "client", hostToken: "host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [{ id: "office", name: "Office", preset: "starter", path: office, workspaceType: "local" }, { id: "second", name: "Second", preset: "starter", path: second, workspaceType: "local" }], authorizedRoots: [office, second], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const server = await startServer(config);
  cleanups.push(async () => { await server.stop(); });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const ws = config.workspaces[0]!;
  const patchConfig = async (id: string, body: unknown) => {
    const response = await fetch(`${baseUrl}/workspace/${id}/config`, { method: "PATCH", headers: { authorization: "Bearer client", "content-type": "application/json" }, body: JSON.stringify(body) });
    expect(response.ok).toBe(true);
    return response;
  };
  return { config, ws, baseUrl, patchConfig };
}

const ollama = { npm: "@ai-sdk/openai-compatible", name: "Ollama", options: { baseURL: "http://localhost:11434/v1" } };

test("PATCH provider zapíše do globálneho riadku; null odstráni z globálneho aj zo starého riadku priečinka", async () => {
  const { config, ws, patchConfig } = await fixture();
  await patchConfig(ws.id, { opencode: { provider: { ollama } } });
  expect((await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID)).provider).toEqual({ ollama });
  expect((await readRuntimeOpencodeConfig(config, ws.id)).provider ?? {}).toEqual({});
  await writeRuntimeOpencodeConfig(config, ws.id, (current) => ({ ...current, provider: { ollama } })); // starý stav
  await patchConfig(ws.id, { opencode: { provider: { ollama: null } } });
  expect((await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID)).provider ?? {}).toEqual({});
  expect((await readRuntimeOpencodeConfig(config, ws.id)).provider ?? {}).toEqual({});
});

test("GET /workspace/:id/config vráti globálneho poskytovateľa aj pre priečinok bez vlastného riadku", async () => {
  const { baseUrl, ws, patchConfig } = await fixture();
  await patchConfig(ws.id, { opencode: { provider: { ollama } } });
  const response = await fetch(`${baseUrl}/workspace/${ws.id}/config`, { headers: { authorization: "Bearer client" } });
  expect(response.ok).toBe(true);
  const body: { opencode?: { provider?: Record<string, unknown> } } = await response.json();
  expect(body.opencode?.provider?.ollama).toEqual(ollama);
});

test("úprava staršieho poskytovateľa z riadku priečinka platí: globálny riadok má v2, priečinok ho už nemá", async () => {
  const { config, baseUrl, ws, patchConfig } = await fixture();
  const v1 = { ...ollama, name: "Ollama v1" }, v2 = { ...ollama, name: "Ollama v2" };
  await writeRuntimeOpencodeConfig(config, ws.id, (current) => ({ ...current, provider: { ollama: v1 } }));
  await patchConfig(ws.id, { opencode: { provider: { ollama: v2 } } });
  expect((await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID)).provider).toEqual({ ollama: v2 });
  expect((await readRuntimeOpencodeConfig(config, ws.id)).provider ?? {}).toEqual({});
  const response = await fetch(`${baseUrl}/workspace/${ws.id}/config`, { headers: { authorization: "Bearer client" } });
  const body: { opencode?: { provider?: Record<string, unknown> } } = await response.json();
  expect(body.opencode?.provider?.ollama).toEqual(v2);
});

test("starý poskytovateľ uložený vo viacerých priečinkoch sa pri úprave aj pri null odstráni zo všetkých riadkov", async () => {
  const { config, baseUrl, ws, patchConfig } = await fixture();
  const v1 = { ...ollama, name: "Ollama v1" }, v2 = { ...ollama, name: "Ollama v2" };
  const seedBoth = async () => {
    for (const id of ["office", "second"]) await writeRuntimeOpencodeConfig(config, id, (current) => ({ ...current, provider: { ollama: v1 } }));
  };
  const getProvider = async (id: string) => {
    const response = await fetch(`${baseUrl}/workspace/${id}/config`, { headers: { authorization: "Bearer client" } });
    const body: { opencode?: { provider?: Record<string, unknown> } } = await response.json();
    return body.opencode?.provider?.ollama;
  };
  await seedBoth();
  await patchConfig(ws.id, { opencode: { provider: { ollama: v2 } } });
  for (const id of ["office", "second"]) expect((await readRuntimeOpencodeConfig(config, id)).provider ?? {}).toEqual({});
  expect(await getProvider("second")).toEqual(v2);
  await seedBoth();
  await patchConfig(ws.id, { opencode: { provider: { ollama: null } } });
  for (const id of ["office", "second"]) expect((await readRuntimeOpencodeConfig(config, id)).provider ?? {}).toEqual({});
  expect(await getProvider("second")).toBeUndefined();
});

test("GET opraví neplatný starý blok a vráti platný globálny poskytovateľ", async () => {
  const { config, baseUrl, ws, patchConfig } = await fixture();
  await patchConfig(ws.id, { opencode: { provider: { ollama } } });
  await writeRuntimeOpencodeConfig(config, ws.id, (current) => ({ ...current, provider: { ollama: { npm: 42 } } }));
  const response = await fetch(`${baseUrl}/workspace/${ws.id}/config`, { headers: { authorization: "Bearer client" } });
  const body: { opencode?: { provider?: Record<string, unknown> } } = await response.json();
  expect(body.opencode?.provider?.ollama).toEqual(ollama);
});

test("rozdielny blok iného priečinka: bez potvrdenia 409 bez zápisu, s potvrdením prepis a audit v každom dotknutom", async () => {
  const { config, baseUrl, ws, patchConfig } = await fixture();
  const local = { ...ollama, name: "Ollama A" }; // klient A: localhost
  const lan = { ...ollama, name: "Ollama B", options: { baseURL: "http://192.168.1.20:11434/v1" } }; // klient B: iný host v LAN
  const v2 = { ...ollama, name: "Ollama A v2" };
  await writeRuntimeOpencodeConfig(config, "office", (current) => ({ ...current, provider: { ollama: local } }));
  await writeRuntimeOpencodeConfig(config, "second", (current) => ({ ...current, provider: { ollama: lan } }));
  const patch = (body: unknown) => fetch(`${baseUrl}/workspace/${ws.id}/config`, { method: "PATCH", headers: { authorization: "Bearer client", "content-type": "application/json" }, body: JSON.stringify(body) });
  const getProvider = async (id: string) => {
    const response = await fetch(`${baseUrl}/workspace/${id}/config`, { headers: { authorization: "Bearer client" } });
    const body: { opencode?: { provider?: Record<string, unknown> } } = await response.json();
    return body.opencode?.provider?.ollama;
  };
  const auditOf = async (id: string) => (await (await fetch(`${baseUrl}/workspace/${id}/audit`, { headers: { authorization: "Bearer client" } })).json()).items as { action: string }[];
  const conflict = { code: "provider_conflict", details: { providerConflicts: [{ providerId: "ollama", workspaces: [{ id: "second", name: "Second" }] }] } };

  // úprava aj odpojenie v A bez potvrdenia: 409 a nič sa nezapíše
  for (const value of [v2, null]) {
    const response = await patch({ opencode: { provider: { ollama: value } } });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject(conflict);
    expect((await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID)).provider ?? {}).toEqual({});
    expect((await readRuntimeOpencodeConfig(config, "office")).provider).toEqual({ ollama: local });
    expect((await readRuntimeOpencodeConfig(config, "second")).provider).toEqual({ ollama: lan });
    expect(await getProvider("second")).toEqual(lan);
  }

  // s potvrdením: globálny riadok má v2, oba staré bloky zmiznú, B má záznam v audite
  const confirmed = await patch({ opencode: { provider: { ollama: v2 } }, confirmProviderOverwrite: true });
  expect(confirmed.status).toBe(200);
  expect((await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID)).provider).toEqual({ ollama: v2 });
  for (const id of ["office", "second"]) expect((await readRuntimeOpencodeConfig(config, id)).provider ?? {}).toEqual({});
  expect(await getProvider("second")).toEqual(v2);
  expect(await auditOf("second")).toEqual(expect.arrayContaining([expect.objectContaining({ action: "config.provider.overwrite" })]));
});

test("zhodný starý blok iného priečinka prejde bez potvrdenia a dotknutý priečinok dostane záznam v audite", async () => {
  const { config, baseUrl, ws, patchConfig } = await fixture();
  const local = { ...ollama, name: "Ollama A" };
  await writeRuntimeOpencodeConfig(config, "office", (current) => ({ ...current, provider: { ollama: local } }));
  await writeRuntimeOpencodeConfig(config, "second", (current) => ({ ...current, provider: { ollama: local } }));
  await patchConfig(ws.id, { opencode: { provider: { ollama: { ...local, name: "Ollama v2" } } } });
  expect((await readRuntimeOpencodeConfig(config, "second")).provider ?? {}).toEqual({});
  const audit = (await (await fetch(`${baseUrl}/workspace/second/audit`, { headers: { authorization: "Bearer client" } })).json()).items as { action: string }[];
  expect(audit).toEqual(expect.arrayContaining([expect.objectContaining({ action: "config.provider.overwrite" })]));
});

test("zmena adresy servera vyžaduje potvrdenie aj pri zhodnom starom bloku a pri globálnom poskytovateľovi (MČ 13. 10.)", async () => {
  const { config, baseUrl, ws } = await fixture();
  const third = join(config.workspaces[0]!.path, "..", "third"), home = join(config.workspaces[0]!.path, "..", "lawoss-domov");
  for (const dir of [third, home]) await mkdir(dir, { recursive: true });
  // C používa len globálneho poskytovateľa; domov sa v zozname nikdy neobjaví.
  config.workspaces.push({ id: "third", name: "Third", preset: "starter", path: third, workspaceType: "local" }, { id: "home", name: "lawoss-domov", preset: "starter", path: home, workspaceType: "local" });
  config.authorizedRoots.push(third, home);
  const local = { ...ollama, name: "Ollama" };
  const cloud = { ...ollama, options: { baseURL: "https://cloud.example/v1" } };
  await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, (current) => ({ ...current, provider: { ollama: local } }));
  await writeRuntimeOpencodeConfig(config, "office", (current) => ({ ...current, provider: { ollama: local } }));
  await writeRuntimeOpencodeConfig(config, "second", (current) => ({ ...current, provider: { ollama: local } }));
  const patch = (body: unknown) => fetch(`${baseUrl}/workspace/${ws.id}/config`, { method: "PATCH", headers: { authorization: "Bearer client", "content-type": "application/json" }, body: JSON.stringify(body) });
  const auditOf = async (id: string) => (await (await fetch(`${baseUrl}/workspace/${id}/audit`, { headers: { authorization: "Bearer client" } })).json()).items as { action: string }[];

  const refused = await patch({ opencode: { provider: { ollama: cloud } } });
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ code: "provider_conflict", details: { providerConflicts: [{ providerId: "ollama", reason: "endpoint_change", workspaces: [{ id: "second", name: "Second" }, { id: "third", name: "Third" }] }] } });
  expect((await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID)).provider).toEqual({ ollama: local });
  expect((await readRuntimeOpencodeConfig(config, "second")).provider).toEqual({ ollama: local });

  // rovnaká adresa, iný názov: bez potvrdenia
  expect((await patch({ opencode: { provider: { ollama: { ...local, name: "Ollama v2" } } } })).status).toBe(200);

  const confirmed = await patch({ opencode: { provider: { ollama: cloud } }, confirmProviderOverwrite: true });
  expect(confirmed.status).toBe(200);
  expect((await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID)).provider).toEqual({ ollama: cloud });
  expect(await auditOf("third")).toEqual(expect.arrayContaining([expect.objectContaining({ action: "config.provider.endpoint" })]));
});

test("nový poskytovateľ, ktorého ostatní klienti nemali, nie je zmena adresy", async () => {
  const { baseUrl, ws } = await fixture();
  const response = await fetch(`${baseUrl}/workspace/${ws.id}/config`, { method: "PATCH", headers: { authorization: "Bearer client", "content-type": "application/json" }, body: JSON.stringify({ opencode: { provider: { ollama: { ...ollama, options: { baseURL: "https://cloud.example/v1" } } } } }) });
  expect(response.status).toBe(200);
});


for (const change of ["replacement", "deletion"] as const) {
  test(`rejected provider ${change} preserves complete refresh state and confirmed changes retain audit and stale-engine guards`, async () => {
    const { config, baseUrl, ws } = await fixture();
    let discoveries = 0, reloads = 0;
    const endpoint = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
      discoveries++;
      return Response.json({ data: [{ id: "stale-model" }] });
    } });
    cleanups.push(async () => { endpoint.stop(true); });
    const local = { ...ollama, name: "Synthetic local provider", options: { baseURL: `http://127.0.0.1:${endpoint.port}/v1` } };
    const different = { ...ollama, name: "Synthetic conflicting provider", options: { baseURL: "http://other-workspace.example.test/v1" } };
    const replacement = { ...local, name: "Synthetic replacement" };
    const refreshed = { enabled: true, disconnected: change === "replacement", baseURL: local.options.baseURL,
      availableModels: ["selected-model", "inventory-model"], lastCheckedAt: 100, lastUpdatedAt: 90,
      lastError: "Synthetic retained discovery failure", pendingReload: true };
    const unrelated = { enabled: true, disconnected: false, baseURL: "http://unrelated.example.test/v1",
      availableModels: ["unrelated-model"], lastCheckedAt: 200, lastUpdatedAt: 180, lastError: null, pendingReload: false };
    await writeLegalworkWorkspaceConfig(config, ws.id, () => ({ sentinel: { keep: "complete workspace configuration" },
      customProviderModelRefresh: { ollama: refreshed, unrelated } }));
    await writeLegalworkWorkspaceConfig(config, "second", () => ({ sentinel: "Other workspace metadata", customProviderModelRefresh: { unrelated } }));
    await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, () => ({ default_agent: "global-sentinel" }));
    await writeRuntimeOpencodeConfig(config, ws.id, () => ({ default_agent: "office-sentinel", provider: { ollama: local } }));
    await writeRuntimeOpencodeConfig(config, "second", () => ({ default_agent: "second-sentinel", provider: { ollama: different } }));
    const ids = [GLOBAL_PROVIDERS_ID, ws.id, "second"];
    const auditOf = async (id: string) => {
      const response = await fetch(`${baseUrl}/workspace/${id}/audit`, { headers: { authorization: "Bearer client" } });
      expect(response.status).toBe(200);
      const body: { items: { action: string }[] } = await response.json();
      return body.items;
    };
    const snapshot = async () => ({
      runtime: await Promise.all(ids.map(id => readRuntimeOpencodeConfig(config, id))),
      legalwork: await Promise.all(ids.map(id => readLegalworkWorkspaceConfig(config, id))),
      audit: await Promise.all([ws.id, "second"].map(auditOf)),
    });
    const before = await snapshot();
    const value = change === "deletion" ? null : replacement;
    const patch = (confirmed: boolean) => fetch(`${baseUrl}/workspace/${ws.id}/config`, {
      method: "PATCH", headers: { authorization: "Bearer client", "content-type": "application/json" },
      body: JSON.stringify({ opencode: { provider: { ollama: value } }, ...(confirmed ? { confirmProviderOverwrite: true } : {}) }),
    });
    const refused = await patch(false);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "provider_conflict", details: { providerConflicts: [{ providerId: "ollama", workspaces: [{ id: "second", name: "Second" }] }] } });
    const after = await snapshot();
    expect(after.runtime).toEqual(before.runtime);
    expect(after.legalwork).toEqual(before.legalwork);
    expect(after.audit).toEqual(before.audit);

    const confirmed = await patch(true);
    expect(confirmed.status).toBe(200);
    await confirmed.json();
    const acceptedConfig = await readLegalworkWorkspaceConfig(config, ws.id);
    expect(acceptedConfig).toEqual({ sentinel: { keep: "complete workspace configuration" }, customProviderModelRefresh: {
      ollama: change === "deletion" ? { ...refreshed, enabled: false, disconnected: true, pendingReload: false } : { ...refreshed, disconnected: false },
      unrelated,
    } });
    expect(await readLegalworkWorkspaceConfig(config, "second")).toEqual(before.legalwork[2]);
    expect((await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID)).provider ?? {}).toEqual(change === "deletion" ? {} : { ollama: replacement });
    for (const id of [ws.id, "second"]) expect((await readRuntimeOpencodeConfig(config, id)).provider ?? {}).toEqual({});
    for (const [index, id] of ids.entries()) expect((await readRuntimeOpencodeConfig(config, id)).default_agent).toBe(before.runtime[index]?.default_agent);
    expect(await auditOf(ws.id)).toEqual(expect.arrayContaining([expect.objectContaining({ action: "config.patch" })]));
    expect(await auditOf("second")).toEqual(expect.arrayContaining([expect.objectContaining({ action: "config.provider.overwrite" })]));
    if (change === "deletion") {
      // The real refresh consumer may still receive the engine's stale provider
      // snapshot. Accepted disconnection must prevent discovery and restoration.
      const refresh = createCustomProviderModelRefresh({ config, readProviders: async () => ({ ollama: local }),
        isBusy: async () => false, reload: async () => { reloads++; } });
      const result = await refresh(ws, { providerId: "ollama", force: true });
      expect(result.providers.ollama.disconnected).toBe(true);
      expect(result.providers.ollama.pendingReload).toBe(false);
      expect(result.reloaded).toBe(false);
      expect(await readLegalworkWorkspaceConfig(config, ws.id)).toEqual(acceptedConfig);
      expect((await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID)).provider ?? {}).toEqual({});
      expect((await readRuntimeOpencodeConfig(config, ws.id)).provider ?? {}).toEqual({});
    }
    expect(discoveries).toBe(0);
    expect(reloads).toBe(0);
  });
}
