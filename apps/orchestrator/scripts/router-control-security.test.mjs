import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Evaluate the actual CLI functions with inert process adapters; importing the CLI
// directly would launch it. No subprocesses, container engines or messaging services run.
const source = ts.createSourceFile("cli.ts", readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
function load(names, globals = {}, extra = []) {
  const requested = new Set([...names, ...extra]);
  const declarations = source.statements.filter((node) =>
    (ts.isFunctionDeclaration(node) && requested.has(node.name?.text)) ||
    (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => requested.has(item.name.getText(source)))));
  const code = ts.transpileModule(declarations.map((node) => node.getText(source)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return vm.runInNewContext(`${code}\n({ ${names.join(", ")} });`, { process: { env: {} }, randomBytes, ...globals });
}
const tokenNames = ["getRouterControlToken", "runtimeRouterControlToken"];
const capability = "bc".repeat(32);

test("router capability is generated once per runtime, respects provisioning, and rejects malformed secrets", () => {
  const fresh = load(["getRouterControlToken"], {}, tokenNames);
  const token = fresh.getRouterControlToken();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(fresh.getRouterControlToken(), token);
  assert.notEqual(load(["getRouterControlToken"], {}, tokenNames).getRouterControlToken(), token);
  assert.equal(load(["getRouterControlToken"], { process: { env: { OPENCODE_ROUTER_CONTROL_TOKEN: capability } } }, tokenNames).getRouterControlToken(), capability);
  assert.throws(() => load(["getRouterControlToken"], { process: { env: { OPENCODE_ROUTER_CONTROL_TOKEN: "short" } } }, tokenNames).getRouterControlToken(), /CONTROL_TOKEN/);
});

function evaluateTool(source, env, fetch) {
  const schema = new Proxy(() => {}, { get: () => schema, apply: () => schema });
  const tool = (definition) => definition;
  tool.schema = schema;
  return vm.runInNewContext(source.replace(/^import .*\n/, "").replace("export default tool(", "tool("), { tool, process: { env }, fetch, URLSearchParams });
}

test("generated send/status tools authenticate actual requests without embedding a secret", async () => {
  const functions = load(["opencodeRouterSendToolSource", "opencodeRouterStatusToolSource"]);
  for (const [name, args] of [["opencodeRouterSendToolSource", { text: "synthetic", channel: "slack", peerId: "test" }], ["opencodeRouterStatusToolSource", { includeBindings: true }]]) {
    const calls = [];
    const generated = functions[name]();
    assert.equal(generated.includes(capability), false);
    const fetch = async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(url.endsWith("/send") ? { sent: 1, attempted: 1 } : url.endsWith("/health") ? { ok: true } : { items: [] }));
    };
    const instance = evaluateTool(generated, { OPENCODE_ROUTER_CONTROL_TOKEN: capability, OPENCODE_ROUTER_HEALTH_PORT: "32123" }, fetch);
    await instance.execute(args, { directory: "/workspace" });
    assert.ok(calls.length >= 1);
    assert.ok(calls.every((call) => call.options.headers.Authorization === `Bearer ${capability}`));
    assert.ok(calls.every((call) => !call.url.includes(capability)));
    const missing = evaluateTool(generated, {}, fetch);
    const before = calls.length;
    await assert.rejects(missing.execute(args, { directory: "/workspace" }), /not provisioned/);
    assert.equal(calls.length, before);
  }
});

test("native child and container environments share one capability without putting it in argv", async () => {
  const calls = [];
  const globals = {
    process: { env: {} },
    spawnProcess: (bin, args, options) => { calls.push({ bin, args, options }); return { pid: 123, stdout: null, stderr: null }; },
    prefixStream() {}, mergeResourceAttributes: () => "", resolveBinCommand: (bin) => ({ command: bin, prefixArgs: [] }),
    opencodeRouterSupportsOpencodeUrl: async () => true,
    stageSandboxRuntime: async () => ({ rootInContainer: "/persist/runtime", entrypointHostPath: "/private/entry.sh", cleanup() {} }),
    writeSandboxEntrypoint: async () => {}, resolveHostOpencodeGlobalConfigDir: async () => null, resolveHostOpencodeGlobalDataDir: async () => null,
    loadUserEnvFile: () => ({}), ensureAppleContainerSystemReady: async () => {},
    SANDBOX_INTERNAL_LEGALWORK_PORT: 8787, SANDBOX_INTERNAL_OPENCODE_ROUTER_HEALTH_PORT: 3005,
  };
  const funcs = load(["startOpencode", "startLegalworkServer", "startOpenCodeRouter", "startDockerSandbox", "startAppleContainerSandbox", "getRouterControlToken"], globals, [...tokenNames, "addEnvPassThroughArgs", "sandboxEnvPassThroughNames", "SANDBOX_INTERNAL_ENV_NAMES"]);
  const options = { bin: "/fake/bin", workspace: "/workspace", bindHost: "127.0.0.1", port: 23456, host: "127.0.0.1", hotReload: { enabled: false, debounceMs: 1, cooldownMs: 1 }, corsOrigins: [], runId: "test", logFormat: "json", logger: { debug() {} }, token: "client-test", hostToken: "host-test", approvalMode: "manual", approvalTimeoutMs: 100, opencodeRouterHealthPort: 3005 };
  await funcs.startOpencode(options); await funcs.startLegalworkServer(options); await funcs.startOpenCodeRouter(options);
  const sandbox = { ...options, dockerCommand: "fake-docker", image: "fake-image", containerName: "test", persistDir: "/persist", opencodeConfigDir: "/config", extraMounts: [], sidecars: { opencode: "/fake/engine", legalworkServer: "/fake/server", opencodeRouter: "/fake/router" }, ports: { legalwork: 12345, opencodeRouterHealth: 12346 }, opencode: options, legalwork: options };
  await funcs.startDockerSandbox(sandbox); await funcs.startAppleContainerSandbox(sandbox);
  const token = funcs.getRouterControlToken();
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.equal(call.options.env.OPENCODE_ROUTER_CONTROL_TOKEN, token);
    assert.equal(JSON.stringify(call.args).includes(token), false);
  }
  for (const call of calls.slice(3)) assert.ok(call.args.includes("OPENCODE_ROUTER_CONTROL_TOKEN"));
});

test("sandbox entrypoint requires an inherited capability and never embeds it", async () => {
  let generated = "";
  const { writeSandboxEntrypoint } = load(["writeSandboxEntrypoint"], {
    writeFile: async (_path, value) => { generated = value; },
    SANDBOX_OPENCODE_GLOBAL_CONFIG_CONTAINER_PATH: "/import/config", SANDBOX_OPENCODE_GLOBAL_DATA_IMPORT_CONTAINER_PATH: "/import/data", SANDBOX_INTERNAL_OPENCODE_PORT: 4096, SANDBOX_INTERNAL_LEGALWORK_PORT: 8787, SANDBOX_INTERNAL_OPENCODE_ROUTER_HEALTH_PORT: 3005,
  }, ["shQuote"]);
  await writeSandboxEntrypoint({ entrypointHostPath: "/fake/script", rootInContainer: "/runtime", opencodeConfigDirInContainer: "/config", backend: "docker", opencode: { corsOrigins: [], hotReload: { enabled: false, debounceMs: 1, cooldownMs: 1 } }, legalwork: { token: capability, hostToken: capability, corsOrigins: [], opencodeRouterEnabled: true, approvalMode: "manual", approvalTimeoutMs: 10, logFormat: "json" }, runId: "test", logFormat: "json" });
  assert.match(generated, /OPENCODE_ROUTER_CONTROL_TOKEN:\?OPENCODE_ROUTER_CONTROL_TOKEN is required/);
  assert.equal(generated.includes(capability), false);
});

test("startup verifies redacted engine configuration through the authenticated workspace proxy", async () => {
  const calls = [];
  const workspace = { id: "workspace-test", path: "/workspace", opencode: { baseUrl: "http://127.0.0.1:4096", directory: "/workspace" } };
  const { verifyLegalworkServer } = load(["verifyLegalworkServer"], {
    AbortSignal,
    normalizeWorkspacePath: (value) => value.replace(/\/+$/, ""),
    assertVersionMatch: (_service, expected, actual) => assert.equal(actual, expected),
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/workspaces")) return Response.json({ items: [workspace] });
      if (url.endsWith("/opencode/global/health")) {
        assert.equal(options.headers.Authorization, "Bearer client-capability");
        return Response.json({ healthy: true, version: "engine-test" });
      }
      if (url.endsWith("/health")) return Response.json({ version: "server-test" });
      if (url.endsWith("/approvals")) return Response.json({ items: [] });
      throw new Error(`Unexpected request: ${url}`);
    },
  }, ["fetchJson"]);
  const result = await verifyLegalworkServer({ baseUrl: "http://127.0.0.1:8787", token: "client-capability", hostToken: "host-capability", expectedVersion: "server-test", expectedWorkspace: "/workspace", expectedOpencodeBaseUrl: workspace.opencode.baseUrl, expectedOpencodeDirectory: "/workspace", expectedOpencodeUsername: "private-engine-user", expectedOpencodePassword: "private-engine-secret" });
  assert.equal(result, "server-test");
  assert.equal(calls.filter((call) => call.url === "http://127.0.0.1:8787/workspace/workspace-test/opencode/global/health").length, 1);
  assert.equal(JSON.stringify(calls).includes("private-engine-secret"), false);
  assert.equal(JSON.stringify(calls).includes("private-engine-user"), false);
});

test("startup rejects upstream authentication failure and unhealthy engine despite valid workspace metadata", async () => {
  for (const status of [401, 200]) {
    let approvalsRead = false;
    const { verifyLegalworkServer } = load(["verifyLegalworkServer"], {
      AbortSignal,
      normalizeWorkspacePath: (value) => value,
      assertVersionMatch() {},
      fetch: async (url, options) => {
        if (url.endsWith("/workspaces")) return Response.json({ items: [{ id: "workspace-test", path: "/workspace", opencode: { baseUrl: "http://127.0.0.1:4096", directory: "/workspace" } }] });
        if (url.endsWith("/opencode/global/health")) {
          assert.equal(options.headers.Authorization, "Bearer client-capability");
          return Response.json(status === 401 ? { message: "Upstream authentication rejected" } : { healthy: false }, { status });
        }
        if (url.endsWith("/health")) return Response.json({ version: "server-test" });
        if (url.endsWith("/approvals")) { approvalsRead = true; return Response.json({ items: [] }); }
        throw new Error(`Unexpected request: ${url}`);
      },
    }, ["fetchJson"]);
    await assert.rejects(verifyLegalworkServer({ baseUrl: "http://127.0.0.1:8787", token: "client-capability", hostToken: "host-capability", expectedWorkspace: "/workspace", expectedOpencodeBaseUrl: "http://127.0.0.1:4096", expectedOpencodeUsername: "configured-user", expectedOpencodePassword: "wrong-password" }), status === 401 ? /HTTP 401/ : /not healthy/);
    assert.equal(approvalsRead, false);
  }
});
