import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfigEntry } from "@opencode/client";
import { localProviderChatCompletionsOnly, nativeProviderDisplay } from "./native-provider-display.js";
import { withRuntimeDb } from "./runtime-db-lifecycle.js";
import type { ServerConfig } from "./types.js";

test("local-template classification accepts only the supported loopback endpoint boundaries", () => {
  for (const protocol of ["http", "https"]) for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    for (const port of [8080, 8000, 1234, 11434]) for (const suffix of ["", "/", "///"]) {
      expect(localProviderChatCompletionsOnly(` ${protocol}://${host}:${port}/v1${suffix} `)).toBe(true);
    }
  }
});

test.each([
  undefined, null, 11434, "", "ollama", "not a URL",
  "https://example.invalid:11434/v1", "http://localhost.example.invalid:11434/v1",
  "http://192.168.1.1:11434/v1", "http://localhost:9999/v1", "http://localhost/v1",
  "http://localhost:11434", "http://localhost:11434/api", "http://localhost:11434/v1/chat/completions",
  "http://localhost:11434/v1?private=value", "http://localhost:11434/v1#private",
  "http://user@localhost:11434/v1", "http://user:password@localhost:11434/v1",
  "ftp://localhost:11434/v1",
])("local-template classification does not infer chat-only support from %p", endpoint => {
  expect(localProviderChatCompletionsOnly(endpoint)).toBe(false);
});

test("provider display uses authoritative endpoints across partial and remote native overrides without revealing URLs", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawoss-provider-display-"));
  const previousDb = process.env.LEGALWORK_RUNTIME_DB;
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  const workspace = { id: "matter", name: "Matter", path: root, workspaceType: "local", preset: "starter" } satisfies ServerConfig["workspaces"][number];
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(root, "server.json"), token: "synthetic", hostToken: "synthetic-host",
    workspaces: [workspace], authorizedRoots: [root], readOnly: true, approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    startedAt: 0, tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false, opencodeBaseUrl: "http://synthetic.invalid" };
  const local = "http://[::1]:11434/v1", remote = "https://synthetic-private.invalid/v1";
  const owned = { arbitrary: { settings: { baseURL: local } }, ollama: { settings: { baseURL: remote } } };
  const projection = join(root, ".opencode", "opencode.json");
  const entries: ConfigEntry[] = [{ type: "document", path: projection, info: { providers: owned } }];
  try {
    await withRuntimeDb(config, async () => {
      const read = () => nativeProviderDisplay(config, workspace, { authored: undefined, owned, combined: owned }, {
        entries, project: { state: "ready", required: false, directory: root, approvalScope: [], projection: { path: projection }, plugins: [] },
      });
      expect(await read()).toEqual({ arbitrary: { hasCustomEndpoint: true, editable: true, chatCompletionsOnly: true }, ollama: { hasCustomEndpoint: true, editable: true } });
      entries.push({ type: "document", path: join(root, "opencode.json"), info: { providers: { arbitrary: { name: "Partial override" } } } });
      expect((await read()).arbitrary).toEqual({ hasCustomEndpoint: true, editable: false, chatCompletionsOnly: true });
      entries.push({ type: "document", info: { providers: { arbitrary: { settings: { baseURL: remote } }, ollama: { settings: { baseURL: local } } } } });
      const display = await read();
      expect(display).toEqual({ arbitrary: { hasCustomEndpoint: true, editable: false }, ollama: { hasCustomEndpoint: true, editable: false, chatCompletionsOnly: true } });
      expect(JSON.stringify(display)).not.toContain(local);
      expect(JSON.stringify(display)).not.toContain(remote);
      config.engineConfigurationMode = "managed";
      expect((await read()).arbitrary).toEqual({ hasCustomEndpoint: true, editable: true, chatCompletionsOnly: true });
    });
  } finally {
    if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    await rm(root, { recursive: true, force: true });
  }
});
