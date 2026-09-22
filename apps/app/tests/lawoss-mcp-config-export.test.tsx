import { describe, expect, test } from "bun:test";

import type { McpServerEntry } from "../src/app/types";
import type { LegalworkServerClient } from "../src/app/lib/legalwork-server";
import type { LegalworkServerStore } from "../src/react-app/domains/connections/legalwork-server-store";
import { createConnectionsStore } from "../src/react-app/domains/connections/store";
import {
  buildMcpConfigExport,
  type McpConfigExportEntry,
} from "../src/lawoss/okf/mcp-config-export";
import {
  downloadMcpConfigJson,
  initialMcpConfigExportDialogState,
  mcpConfigExportFilename,
  mcpConfigExportDialogReducer,
  mcpConfigExportSelectionKey,
  runMcpConfigExportDownload,
  type BrowserDownloadPort,
} from "../src/lawoss/domains/integrations/mcp-config-export";

const local: McpServerEntry = {
  name: "local-files",
  source: "config.project",
  disabledByTools: false,
  config: {
    type: "local",
    command: ["bunx", "@example/files", "--token=download-secret"],
    cwd: "/workspace/matter",
    environment: { Z_TOKEN: "secret", A_MODE: "read-only" },
    enabled: true,
    timeout: 12_000,
  },
};

const remote: McpServerEntry = {
  name: "remote-drive",
  source: "config.remote",
  disabledByTools: true,
  config: {
    type: "remote",
    url: "https://mcp.example.test/connect",
    enabled: true,
    headers: { Z_Authorization: "Bearer download-secret", A_Accept: "application/json" },
    oauth: {
      clientId: "client-id",
      clientSecret: "download-secret",
      scope: "files.read",
      callbackPort: 43210,
      redirectUri: "http://127.0.0.1:43210/oauth/callback",
    },
    timeout: 9_000,
  },
};

describe("LAWOSS MCP config export builder", () => {
  test("retains every pinned v2 field, canonicalizes order and preserves effective disables", () => {
    const result = buildMcpConfigExport([remote, local], ["remote-drive", "local-files"]);

    expect(result.json).toBe(JSON.stringify({
      mcp: {
        "local-files": {
          type: "local",
          command: ["bunx", "@example/files", "--token=download-secret"],
          cwd: "/workspace/matter",
          environment: { A_MODE: "read-only", Z_TOKEN: "secret" },
          enabled: true,
          timeout: 12_000,
        },
        "remote-drive": {
          type: "remote",
          url: "https://mcp.example.test/connect",
          enabled: false,
          headers: { A_Accept: "application/json", Z_Authorization: "Bearer download-secret" },
          oauth: {
            clientId: "client-id",
            clientSecret: "download-secret",
            scope: "files.read",
            callbackPort: 43210,
            redirectUri: "http://127.0.0.1:43210/oauth/callback",
          },
          timeout: 9_000,
        },
      },
    }, null, 2) + "\n");
    expect(result.selected).toEqual([
      { name: "local-files", source: "config.project", disabledReasons: [] },
      { name: "remote-drive", source: "config.remote", disabledReasons: ["tools"] },
    ]);
    expect(result.json).not.toContain("disabledByTools");
    expect(result.json).not.toContain("source");
  });

  test("is byte deterministic and treats prototype names as ordinary own keys", () => {
    const special = ["prototype", "__proto__", "constructor"].map((name) => ({
      name,
      source: "config.global" as const,
      disabledByTools: false,
      config: { type: "remote" as const, url: `https://example.test/${name}`, oauth: false },
    }));
    const first = buildMcpConfigExport(special, ["prototype", "constructor", "__proto__"]);
    const second = buildMcpConfigExport([...special].reverse(), ["__proto__", "prototype", "constructor"]);

    expect(first.json).toBe(second.json);
    expect(Object.getPrototypeOf(first.payload.mcp)).toBeNull();
    expect(Object.keys(first.payload.mcp)).toEqual(["__proto__", "constructor", "prototype"]);
    expect(Object.hasOwn(first.payload.mcp, "__proto__")).toBe(true);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  test("preserves optional presence, OAuth false/empty object and both disabled reasons", () => {
    const result = buildMcpConfigExport([
      { name: "implicit", disabledByTools: false, config: { type: "remote", url: "https://example.test/implicit", oauth: {} } },
      { name: "no-oauth", disabledByTools: false, config: { type: "remote", url: "https://example.test/no-oauth", oauth: false } },
      { name: "paused", disabledByTools: true, config: { type: "local", command: ["tool"], enabled: false } },
    ], ["paused", "implicit", "no-oauth"]);

    expect(result.payload.mcp.implicit).toEqual({ type: "remote", url: "https://example.test/implicit", oauth: {} });
    expect(Object.hasOwn(result.payload.mcp.implicit, "enabled")).toBe(false);
    expect(result.payload.mcp["no-oauth"]).toEqual({ type: "remote", url: "https://example.test/no-oauth", oauth: false });
    expect(result.payload.mcp.paused).toEqual({ type: "local", command: ["tool"], enabled: false });
    expect(result.selected.find((entry) => entry.name === "paused")?.disabledReasons).toEqual(["config", "tools"]);
  });

  test("rejects unknown state, ambiguity, missing selections and incomplete overlays", () => {
    expect(() => buildMcpConfigExport([local], [])).toThrow("Select at least one MCP connector");
    expect(() => buildMcpConfigExport([local], ["missing"])).toThrow("MCP missing: selected connector was not found");
    expect(() => buildMcpConfigExport([local, { ...local }], [local.name])).toThrow("MCP local-files: duplicate effective entry");
    expect(() => buildMcpConfigExport([{ name: "fallback", config: { type: "local", command: ["tool"] } }], ["fallback"]))
      .toThrow("MCP fallback: effective disabled state is unknown");
    expect(() => buildMcpConfigExport([{ name: "overlay", disabledByTools: false, config: { enabled: false } }], ["overlay"]))
      .toThrow("MCP overlay: missing type/config");
  });

  test("rejects malformed or unsupported local and remote fields with connector-specific errors", () => {
    const bad = (name: string, config: unknown) => [{ name, disabledByTools: false, config }] satisfies McpConfigExportEntry[];
    expect(() => buildMcpConfigExport(bad("null", null), ["null"])).toThrow("MCP null: config must be an object");
    expect(() => buildMcpConfigExport(bad("array", []), ["array"])).toThrow("MCP array: config must be an object");
    expect(() => buildMcpConfigExport(bad("type", { type: "socket" }), ["type"])).toThrow("MCP type: type must be local or remote");
    expect(() => buildMcpConfigExport(bad("local", { type: "local", command: [] }), ["local"])).toThrow("MCP local: command must be a non-empty string array");
    expect(() => buildMcpConfigExport(bad("cwd", { type: "local", command: ["tool"], cwd: 4 }), ["cwd"])).toThrow("MCP cwd: cwd must be a string");
    expect(() => buildMcpConfigExport(bad("env", { type: "local", command: ["tool"], environment: { TOKEN: 4 } }), ["env"])).toThrow("MCP env: environment.TOKEN must be a string");
    expect(() => buildMcpConfigExport(bad("url", { type: "remote", url: "https://{tenant}.example.test/mcp" }), ["url"])).toThrow("MCP url: url contains an unfilled placeholder");
    expect(() => buildMcpConfigExport(bad("url-scheme", { type: "remote", url: "file:///tmp/mcp" }), ["url-scheme"])).toThrow("MCP url-scheme: url must start with http(s)://");
    expect(() => buildMcpConfigExport(bad("header", { type: "remote", url: "https://example.test", headers: { Authorization: 4 } }), ["header"])).toThrow("MCP header: headers.Authorization must be a string");
    expect(() => buildMcpConfigExport(bad("oauth", { type: "remote", url: "https://example.test", oauth: true }), ["oauth"])).toThrow("MCP oauth: oauth must be false or an object");
    expect(() => buildMcpConfigExport(bad("oauth-port", { type: "remote", url: "https://example.test", oauth: { callbackPort: Number.POSITIVE_INFINITY } }), ["oauth-port"])).toThrow("MCP oauth-port: oauth.callbackPort must be a finite number");
    expect(() => buildMcpConfigExport(bad("timeout", { type: "local", command: ["tool"], timeout: Number.NaN }), ["timeout"])).toThrow("MCP timeout: timeout must be a finite number");
    expect(() => buildMcpConfigExport(bad("unknown", { type: "remote", url: "https://example.test", token: "hidden" }), ["unknown"])).toThrow("MCP unknown: unsupported field token");
    expect(() => buildMcpConfigExport(bad("oauth-extra", { type: "remote", url: "https://example.test", oauth: { accessToken: "hidden" } }), ["oauth-extra"])).toThrow("MCP oauth-extra: unsupported oauth field accessToken");
  });
});

describe("LAWOSS MCP export approval and local download", () => {
  test("open, selection, confirmation and cancel are explicit and side-effect free", () => {
    let state = initialMcpConfigExportDialogState;
    let downloads = 0;
    const download = () => { downloads += 1; };

    state = mcpConfigExportDialogReducer(state, { type: "open" });
    expect(state).toMatchObject({ open: true, selectedNames: [], confirmed: false, error: null });
    expect(() => runMcpConfigExportDownload({ state, entries: [local], workspaceIdentity: "matter", filename: "matter-mcp.json", download })).toThrow("Confirm the MCP export first");
    state = mcpConfigExportDialogReducer(state, { type: "toggle", name: local.name });
    expect(state.confirmed).toBe(false);
    const entries = [local];
    state = mcpConfigExportDialogReducer(state, { type: "confirm", value: true, approval: {
      entries,
      workspaceIdentity: "matter",
      selectionKey: mcpConfigExportSelectionKey(state.selectedNames),
    } });
    const built = runMcpConfigExportDownload({ state, entries, workspaceIdentity: "matter", filename: "matter-mcp.json", download });
    expect(downloads).toBe(1);
    expect(built.json).toContain('"local-files"');
    state = mcpConfigExportDialogReducer(state, { type: "reset" });
    expect(state).toEqual(initialMcpConfigExportDialogState);
    expect(downloads).toBe(1);
  });

  test("workspace/config reset invalidates stale approval and malformed current config never downloads", () => {
    let state = mcpConfigExportDialogReducer(initialMcpConfigExportDialogState, { type: "open" });
    state = mcpConfigExportDialogReducer(state, { type: "toggle", name: local.name });
    const approvedEntries = [local];
    state = mcpConfigExportDialogReducer(state, { type: "confirm", value: true, approval: {
      entries: approvedEntries,
      workspaceIdentity: "matter",
      selectionKey: mcpConfigExportSelectionKey(state.selectedNames),
    } });
    expect(() => runMcpConfigExportDownload({
      state,
      entries: [...approvedEntries],
      workspaceIdentity: "matter",
      filename: "matter-mcp.json",
      download: () => { throw new Error("must not download"); },
    })).toThrow("MCP export approval is stale");
    expect(() => runMcpConfigExportDownload({
      state,
      entries: approvedEntries,
      workspaceIdentity: "other-matter",
      filename: "other-matter-mcp.json",
      download: () => { throw new Error("must not download"); },
    })).toThrow("MCP export approval is stale");
    state = mcpConfigExportDialogReducer(state, { type: "reset" });
    let downloads = 0;
    const download = () => { downloads += 1; };
    expect(() => runMcpConfigExportDownload({ state, entries: [local], workspaceIdentity: "matter", filename: "matter-mcp.json", download })).toThrow("Confirm the MCP export first");

    state = mcpConfigExportDialogReducer(initialMcpConfigExportDialogState, { type: "open" });
    state = mcpConfigExportDialogReducer(state, { type: "toggle", name: "broken" });
    const brokenEntries = [{ name: "broken", disabledByTools: false, config: { enabled: true } }];
    state = mcpConfigExportDialogReducer(state, { type: "confirm", value: true, approval: {
      entries: brokenEntries,
      workspaceIdentity: "matter",
      selectionKey: mcpConfigExportSelectionKey(state.selectedNames),
    } });
    expect(() => runMcpConfigExportDownload({
      state,
      entries: brokenEntries,
      workspaceIdentity: "matter",
      filename: "matter-mcp.json",
      download,
    })).toThrow("MCP broken: missing type/config");
    expect(downloads).toBe(0);
  });

  test("download filenames are deterministic and filesystem-safe", () => {
    expect(mcpConfigExportFilename("Žaloba / Klient .. 2026")).toBe("zaloba-klient-2026-mcp.json");
    expect(mcpConfigExportFilename("../..")).toBe("workspace-mcp.json");
  });

  test("download uses one Blob URL and cleans the anchor and URL even when click throws", () => {
    const events: string[] = [];
    const anchor = {
      href: "",
      download: "",
      hidden: false,
      click() { events.push("click"); throw new Error("synthetic click failure"); },
      remove() { events.push("remove"); },
    };
    const port: BrowserDownloadPort = {
      createBlob(content, mimeType) {
        events.push(`${mimeType}:${content}`);
        return new Blob([content], { type: mimeType });
      },
      createObjectURL() { events.push("create-url"); return "blob:synthetic"; },
      createAnchor() { events.push("create-anchor"); return anchor; },
      appendAnchor() { events.push("append"); },
      revokeObjectURL(url) { events.push(`revoke:${url}`); },
    };

    expect(() => downloadMcpConfigJson({ filename: "matter-mcp.json", content: "{}\n", mimeType: "application/json" }, port)).toThrow("synthetic click failure");
    expect(anchor.href).toBe("blob:synthetic");
    expect(anchor.download).toBe("matter-mcp.json");
    expect(events).toEqual([
      "application/json:{}\n",
      "create-url",
      "create-anchor",
      "append",
      "click",
      "remove",
      "revoke:blob:synthetic",
    ]);
  });
});

describe("effective MCP handoff", () => {
  test("server reads set an explicit tools boolean and file fallback clears it on every retained entry", async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const browserWindow = new EventTarget() as EventTarget & {
      __LEGALWORK_ELECTRON__: {
        invokeDesktop: (command: string, ...args: unknown[]) => Promise<unknown>;
      };
    };
    browserWindow.__LEGALWORK_ELECTRON__ = {
      invokeDesktop: async (command, scope) => {
        if (command !== "readOpencodeConfig") throw new Error(`Unexpected desktop command: ${command}`);
        const content = scope === "global"
          ? JSON.stringify({ mcp: { shared: { type: "remote", url: "https://global.example.test/mcp" } } })
          : JSON.stringify({ mcp: { shared: { type: "remote", url: "https://project.example.test/mcp" } } });
        return { path: `/synthetic/${scope}.json`, exists: true, content };
      },
    };
    Object.defineProperty(globalThis, "window", { configurable: true, value: browserWindow });

    let connected = true;
    const client = {
      listMcp: async () => ({
        items: [
          { name: "allowed", config: { type: "remote", url: "https://allowed.example.test/mcp" }, source: "config.global" as const },
          { name: "runtime", config: { type: "remote", url: "https://runtime.example.test/mcp" }, source: "config.remote" as const, disabledByTools: true },
        ],
      }),
    } as unknown as LegalworkServerClient;
    const legalworkServer = {
      getSnapshot: () => ({
        legalworkServerStatus: connected ? "connected" : "disconnected",
        legalworkServerClient: connected ? client : null,
        legalworkServerCapabilities: connected ? { mcp: { read: true } } : null,
        legalworkServerBaseUrl: "",
        legalworkServerAuth: {},
      }),
    } as unknown as LegalworkServerStore;
    const store = createConnectionsStore({
      client: () => null,
      setClient: () => undefined,
      projectDir: () => "/synthetic/workspace",
      selectedWorkspaceId: () => "workspace",
      selectedWorkspaceRoot: () => "/synthetic/workspace",
      workspaceType: () => "local",
      legalworkServer,
      runtimeWorkspaceId: () => "runtime-workspace",
      developerMode: () => false,
    });

    try {
      await store.refreshMcpServers();
      expect(store.getSnapshot().mcpServers.map((entry) => [entry.name, entry.disabledByTools])).toEqual([
        ["allowed", false],
        ["runtime", true],
      ]);

      connected = false;
      await store.refreshMcpServers();
      const fallback = store.getSnapshot().mcpServers;
      expect(fallback.map((entry) => [entry.name, entry.config.url, entry.source])).toEqual([
        ["shared", "https://project.example.test/mcp", "config.project"],
        ["runtime", "https://runtime.example.test/mcp", "config.remote"],
      ]);
      expect(fallback.every((entry) => entry.disabledByTools === undefined)).toBe(true);
      expect(() => buildMcpConfigExport(fallback, ["runtime"])).toThrow("MCP runtime: effective disabled state is unknown");
    } finally {
      store.dispose();
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });
});
