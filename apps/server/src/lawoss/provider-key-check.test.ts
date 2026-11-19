// LAWOSS #574: overenie kľúča OpenRouter na workeri, bez skutočnej siete.
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkProviderKey } from "./provider-key-check.js";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";

const stops: Array<() => unknown> = [];
afterEach(async () => { while (stops.length) await stops.pop()?.(); });

function keyEndpoint(status: number) {
  const seen: Array<string | null> = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    seen.push(request.headers.get("authorization"));
    return status === 200 ? Response.json({ data: { label: "sk-or-v1-abc...xyz" } }) : Response.json({ error: { message: "User not found.", code: status } }, { status });
  } });
  stops.push(() => server.stop(true));
  return { endpoints: { openrouter: `http://127.0.0.1:${server.port}/api/v1/key` }, seen };
}

test("OpenRouter: 200 je platný kľúč a worker pošle kľúč ako Bearer", async () => {
  const { endpoints, seen } = keyEndpoint(200);
  expect(await checkProviderKey("openrouter", "sk-or-v1-good", endpoints)).toBe("valid");
  expect(seen).toEqual(["Bearer sk-or-v1-good"]);
});

test("OpenRouter: 401 je odmietnutý kľúč", async () => {
  const { endpoints } = keyEndpoint(401);
  expect(await checkProviderKey("openrouter", "not-a-key", endpoints)).toBe("rejected");
});

test("OpenRouter: iná odpoveď alebo nedostupná sieť kľúč neodmietne", async () => {
  for (const status of [403, 429, 500]) {
    const { endpoints } = keyEndpoint(status);
    expect(await checkProviderKey("openrouter", "sk-or-v1-x", endpoints)).toBe("unverified");
  }
  const closed = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const offline = `http://127.0.0.1:${closed.port}/api/v1/key`;
  closed.stop(true);
  expect(await checkProviderKey("openrouter", "sk-or-v1-x", { openrouter: offline })).toBe("unverified");
});

test("poskytovateľ bez overovacieho koncového bodu sa neoveruje", async () => {
  expect(await checkProviderKey("anthropic", "sk-ant-x", {})).toBe("unchecked");
});

test("trasa odmietne kľúč s medzerou a nikdy nevráti kľúč", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawoss-key-check-"));
  stops.push(() => rm(root, { recursive: true, force: true }));
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "key-check", hostToken: "key-check-host", configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: [{ id: "ws_key", name: "Workspace", path: root, preset: "starter", workspaceType: "local" }],
    opencodeBaseUrl: "http://127.0.0.1:1", authorizedRoots: [root], readOnly: false, startedAt: Date.now(),
    tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const server = await startServer(config);
  stops.push(() => server.stop());
  const post = (body: unknown) => fetch(`http://127.0.0.1:${server.port}/workspace/ws_key/provider-key-check`, {
    method: "POST", headers: { Authorization: `Bearer ${config.token}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const spaced = await post({ providerId: "openrouter", apiKey: "toto nie je kluc" });
  expect(spaced.status).toBe(400);
  expect(await spaced.text()).not.toContain("toto nie je kluc");
  const unchecked = await post({ providerId: "anthropic", apiKey: "sk-ant-secret-0000" });
  expect(await unchecked.json()).toEqual({ result: "unchecked" });
});
