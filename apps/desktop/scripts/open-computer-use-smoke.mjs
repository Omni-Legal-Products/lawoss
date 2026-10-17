// Verifies the bundled Windows builds, downloads the Mac release, and checks MCP / OpenCode.
// Does not invoke desktop actions or a model. Run with an OpenCode executable:
// node scripts/open-computer-use-smoke.mjs --opencode /absolute/path/to/opencode
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
import { createOpenComputerUseIntegration } from "../electron/open-computer-use.mjs";

const run = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), "legalwork-ocu-smoke-"));
let engine;
let nativeBinary;
try {
  for (const arch of ["x64", "arm64"]) {
    const windows = createOpenComputerUseIntegration({ getDataDir: () => root, platform: "win32", arch });
    const config = await windows.mcpConfig();
    assert.equal((await readFile(config.command[0])).subarray(0, 2).toString(), "MZ");
    console.log(`Windows ${arch}: bundled build digest verified and executable installed`);
  }
  if (process.platform !== "darwin" && process.platform !== "win32") {
    throw new Error("The native MCP smoke test requires Mac or Windows.");
  }
  const runtime = createOpenComputerUseIntegration({ getDataDir: () => root });
  const config = await runtime.mcpConfig();
  nativeBinary = config.command[0];
  if (process.platform === "darwin") {
    await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", path.dirname(path.dirname(path.dirname(nativeBinary)))]);
    console.log("Mac: release digest verified and app signature verified");
    const readiness = await runtime.status();
    assert.equal(readiness.error, undefined);
    assert.equal(typeof readiness.accessibility, "boolean");
    assert.equal(typeof readiness.screenRecording, "boolean");
    console.log("Mac: native permission status parsed without opening onboarding");
  }
  const child = spawn(config.command[0], config.command.slice(1), { env: { ...process.env, ...config.environment }, stdio: ["pipe", "pipe", "pipe"] });
  const lines = readline.createInterface({ input: child.stdout });
  try {
    const catalog = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Native MCP handshake timed out")), 20_000);
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Native MCP exited (${code})`)); });
      lines.on("line", (line) => {
        const response = JSON.parse(line);
        if (response.error) { clearTimeout(timeout); reject(new Error(JSON.stringify(response.error))); return; }
        if (response.id === 1) {
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
        }
        if (response.id === 2) { clearTimeout(timeout); resolve(response.result.tools); }
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "legalwork-smoke", version: "1" } } })}\n`);
    });
    assert.ok(Array.isArray(catalog));
    for (const name of ["list_apps", "get_app_state", "click", "type_text", "press_key", "scroll", "drag", "set_value"]) {
      assert.ok(catalog.some((tool) => tool.name === name), `Missing MCP tool: ${name}`);
    }
    console.log(`Native MCP: initialize and tools/list passed (${catalog.length} tools)`);
  } finally {
    lines.close();
    await stopChild(child);
  }

  const opencodeIndex = process.argv.indexOf("--opencode");
  const opencode = opencodeIndex >= 0 ? process.argv[opencodeIndex + 1] : undefined;
  if (!opencode) throw new Error("Pass --opencode /absolute/path/to/opencode to verify the engine connection.");
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { server.close(); reject(new Error("No test port")); return; }
      server.close(() => resolve(address.port));
    });
  });
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  engine = spawn(path.resolve(opencode), ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: workspace,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"),
      XDG_CACHE_HOME: path.join(root, "cache"), XDG_STATE_HOME: path.join(root, "state"),
      OPENCODE_CONFIG_DIR: path.join(root, "config", "opencode"),
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [] }), OPENCODE_SERVER_PASSWORD: "",
    },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  let started = false;
  for (let attempt = 0; attempt < 75 && !started; attempt += 1) {
    started = await fetch(`${base}/global/health`).then((response) => response.ok).catch(() => false);
    if (!started) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(started, "OpenCode server did not start");
  const response = await fetch(`${base}/mcp?directory=${encodeURIComponent(workspace)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "open-computer-use", config: { type: "local", enabled: true, ...config } }),
  });
  assert.ok(response.ok, `OpenCode MCP registration failed: ${await response.text()}`);
  // Confirm the server remains connected after registration.
  const statuses = await fetch(`${base}/mcp?directory=${encodeURIComponent(workspace)}`).then((result) => result.json());
  assert.equal(statuses["open-computer-use"]?.status, "connected");
  assert.equal(statuses["computer-use"], undefined);
  console.log("OpenCode: open-computer-use connected with its own server identity");
} finally {
  await stopChild(engine);
  // macOS keeps the app agent alive after a stdio client closes. Stop only the
  // agent launched from this smoke test's unique temporary installation.
  if (nativeBinary && process.platform === "darwin") {
    const { stdout } = await run("/bin/ps", ["-axo", "pid=,command="]);
    for (const line of stdout.split("\n")) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (match && (match[2] === nativeBinary || match[2].startsWith(`${nativeBinary} `))) {
        try { process.kill(Number(match[1]), "SIGTERM"); } catch { /* Already stopped. */ }
      }
    }
  }
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); resolve(undefined); }, 5_000);
    child.once("exit", () => { clearTimeout(timeout); resolve(undefined); });
    child.kill();
  });
}
