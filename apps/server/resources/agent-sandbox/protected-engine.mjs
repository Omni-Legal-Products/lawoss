/** Fixed guest launcher. This file and its bundle are measured by the host.
 * RPC travels through the worker's restricted HTTP proxy, never stdout.
 * Engine storage is guest-local; no host workspace/config/auth is mounted. */
import { spawn } from "node:child_process";
import { Agent, createServer, request } from "node:http";
import { copyFile, chmod, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { once } from "node:events";

const ORIGIN = "http://protected-lawoss.invalid";
const ROOT = "/tmp/home/protected-engine";
const BUNDLE = "/authorized/0";
const MAX_BODY = 4 * 1024 * 1024;
const MAX_RESPONSE = 16 * 1024 * 1024;
const CHUNK = 32 * 1024;
const tasks = new Map();
const lifetime = new AbortController();
// Node 24 can configure its GLOBAL http agent from NODE_USE_ENV_PROXY before
// user code runs. Explicit empty proxyEnv is required even for node:http.
const privateAgent = new Agent({ keepAlive: false, proxyEnv: {} });
let child;
let server;
let phase = "bundle";
let healthState = "unobserved";
let checkpointing = false;
// Defense in depth; private engine HTTP below uses direct node:http regardless.
process.env.NO_PROXY = process.env.no_proxy = "127.0.0.1,localhost";

function capability(path, body, signal = lifetime.signal) {
  const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  if (data && data.length > MAX_BODY) throw new Error("Capability body exceeds bound");
  return new Promise((resolve, reject) => {
    // Explicit proxy routing: Node's environment proxy support is not assumed.
    const req = request({ agent: privateAgent, hostname: "127.0.0.1", port: 3128, method: data ? "POST" : "GET", path: ORIGIN + path,
      headers: { host: "protected-lawoss.invalid", ...(data ? { "content-type": "application/json", "content-length": String(data.length) } : {}) }, signal }, (res) => {
      const chunks = []; let size = 0;
      res.on("data", (chunk) => { size += chunk.length; if (size > MAX_RESPONSE) res.destroy(new Error("Capability response exceeds bound")); else chunks.push(chunk); });
      res.on("error", reject);
      res.on("end", () => {
        if (res.statusCode !== 200) { reject(new Error("Protected capability refused")); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (error) { reject(error); }
      });
    });
    req.setTimeout(30_000, () => req.destroy(new Error("Capability request timed out")));
    req.on("error", reject); req.end(data);
  });
}

function privateRequest(port, path, method, headers, body, signal) {
  return new Promise((resolve, reject) => {
    const req = request({ agent: privateAgent, hostname: "127.0.0.1", port, path, method, headers, signal }, resolve);
    req.on("error", reject); req.end(body);
  });
}


async function fileDigest(file) {
  const hash = createHash("sha256"); let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    if (bytes > MAX_RESPONSE) throw new Error("Checkpoint exceeds its bound");
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function checkpoint(command, enginePort, authorization, signal) {
  if (checkpointing) throw new Error("Checkpoint is already in progress");
  checkpointing = true;
  const file = `${ROOT}/tmp/checkpoint.sqlite`;
  let backup;
  try {
    const status = await privateRequest(enginePort, "/session/status", "GET", { authorization }, undefined, signal);
    let statusBytes = 0; const parts = [];
    try { for await (const part of status) { statusBytes += part.length; if (statusBytes > 65536) throw new Error("Session status exceeds its bound"); parts.push(part); } }
    finally { status.destroy(); }
    const sessions = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (status.statusCode !== 200 || !sessions || typeof sessions !== "object" || Array.isArray(sessions) ||
        Object.values(sessions).some(value => !value || value.type !== "idle")) throw new Error("Protected engine is not idle");
    await rm(file, { force: true });
    const python = `import sqlite3,os
source=sqlite3.connect('file:${ROOT}/engine.sqlite?mode=ro',uri=True,timeout=5)
target=sqlite3.connect('${ROOT}/tmp/checkpoint.sqlite',timeout=5)
try:
 page_size=source.execute('PRAGMA page_size').fetchone()[0]
 def bounded(status,remaining,total):
  if total*page_size>${MAX_RESPONSE}: raise ValueError('Checkpoint exceeds its bound')
 source.backup(target,pages=128,progress=bounded,sleep=0.001)
 target.execute('PRAGMA journal_mode=DELETE')
 if target.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise ValueError('Invalid checkpoint')
finally:
 target.close()
 source.close()
`;
    backup = spawn("/usr/local/bin/python3", ["-I", "-c", python], { stdio: "ignore", shell: false,
      signal: AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(10_000)]) });
    const [code] = await once(backup, "exit");
    if (code !== 0) throw new Error("Consistent checkpoint failed");
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 16 || info.size > MAX_RESPONSE) throw new Error("Invalid checkpoint file");
    const digest = await fileDigest(file);
    await capability("/rpc/result", { kind: "head", id: command.id, status: 200, headers: { "content-type": "application/octet-stream", "x-protected-sha256": digest } }, signal);
    for await (const part of createReadStream(file, { highWaterMark: CHUNK })) {
      await capability("/rpc/result", { kind: "chunk", id: command.id, data: part.toString("base64") }, signal);
    }
    await capability("/rpc/result", { kind: "end", id: command.id }, signal);
  } finally {
    if (backup && backup.exitCode === null && backup.signalCode === null) { backup.kill("SIGKILL"); await once(backup, "close").catch(() => {}); }
    await rm(file, { force: true });
    checkpointing = false;
  }
}

async function execute(command, enginePort, authorization) {
  if (!command || !/^[0-9a-f-]{36}$/.test(command.id)) throw new Error("Invalid host request identity");
  if (command.kind === "cancel") { tasks.get(command.id)?.abort(); return; }
  if (command.kind !== "request" || tasks.has(command.id) || tasks.size >= 12 ||
      typeof command.path !== "string" || !command.path.startsWith("/") || command.path.startsWith("//") || command.path.includes("\\") ||
      typeof command.bodyBase64 !== "string" || command.bodyBase64.length > Math.ceil(MAX_BODY / 3) * 4 ||
      !["GET", "POST", "PATCH", "DELETE"].includes(command.method)) throw new Error("Invalid host request");
  const target = new URL(command.path, `http://127.0.0.1:${enginePort}`);
  if (target.origin !== `http://127.0.0.1:${enginePort}`) throw new Error("Invalid private engine origin");
  const controller = new AbortController();
  tasks.set(command.id, controller);
  try {
    if (target.pathname === "/_protected/checkpoint") {
      if (command.method !== "GET" || target.search || target.hash || command.bodyBase64 !== "") throw new Error("Invalid checkpoint capability");
      await checkpoint(command, enginePort, authorization, AbortSignal.any([lifetime.signal, controller.signal]));
      return;
    }
    if (checkpointing && command.method !== "GET") throw new Error("Protected engine checkpoint is in progress");
    const headers = { authorization };
    for (const name of ["accept", "content-type"]) if (typeof command.headers?.[name] === "string") headers[name] = command.headers[name];
    const body = Buffer.from(command.bodyBase64, "base64");
    if (body.length > MAX_BODY) throw new Error("Host request exceeds bound");
    const response = await privateRequest(enginePort, target.pathname + target.search, command.method, headers, body,
      AbortSignal.any([lifetime.signal, controller.signal]));
    await capability("/rpc/result", { kind: "head", id: command.id, status: response.statusCode ?? 502,
      headers: Object.fromEntries(Object.entries(response.headers).filter(([name, value]) => ["content-type", "cache-control"].includes(name) && typeof value === "string")) });
    let size = 0;
    try {
      for await (const part of response) {
        size += part.byteLength; if (size > MAX_RESPONSE) throw new Error("Private engine response exceeds bound");
        for (let offset = 0; offset < part.byteLength; offset += CHUNK) {
          controller.signal.throwIfAborted();
          await capability("/rpc/result", { kind: "chunk", id: command.id, data: Buffer.from(part.subarray(offset, offset + CHUNK)).toString("base64") }, AbortSignal.any([lifetime.signal, controller.signal]));
        }
      }
    } finally { response.destroy(); }
    await capability("/rpc/result", { kind: "end", id: command.id });
  } catch {
    if (!controller.signal.aborted && !lifetime.signal.aborted) await capability("/rpc/result", { kind: "error", id: command.id, message: "Private protected engine request failed" }).catch(() => {});
  } finally { tasks.delete(command.id); }
}

async function start() {
  const bundle = JSON.parse(await readFile(`${BUNDLE}/config.json`, "utf8"));
  const model = bundle.model;
  if (!model || typeof model.id !== "string" || !/^[A-Za-z0-9_.:/-]{1,256}$/.test(model.id) ||
      !Number.isInteger(model.context) || !Number.isInteger(model.output) || model.context < 1 || model.output < 1) throw new Error("Invalid fixed protected model");
  await mkdir(ROOT, { recursive: true, mode: 0o700 });
  for (const name of ["workspace", "config", "data", "state", "cache", "bin", "tmp"]) await mkdir(`${ROOT}/${name}`, { mode: 0o700 });
  // Executable and live SQLite never run over brokered FUSE or host client files.
  phase = "copy-executable";
  await copyFile(`${BUNDLE}/opencode`, `${ROOT}/bin/opencode`);
  await chmod(`${ROOT}/bin/opencode`, 0o500);
  phase = "restore-checkpoint";
  let snapshot;
  try { snapshot = await lstat(`${BUNDLE}/snapshot.sqlite`); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  if (bundle.checkpointSha256 !== undefined || snapshot) {
    if (typeof bundle.checkpointSha256 !== "string" || !/^[a-f0-9]{64}$/.test(bundle.checkpointSha256) || !snapshot?.isFile() || snapshot.isSymbolicLink() || snapshot.size < 16 || snapshot.size > MAX_RESPONSE) throw new Error("Invalid protected checkpoint binding");
    if (await fileDigest(`${BUNDLE}/snapshot.sqlite`) !== bundle.checkpointSha256) throw new Error("Protected checkpoint hash changed");
    await copyFile(`${BUNDLE}/snapshot.sqlite`, `${ROOT}/engine.sqlite`);
    await chmod(`${ROOT}/engine.sqlite`, 0o600);
  }
  const tools = Object.fromEntries(["lawoss_documents_list", "lawoss_documents_read", "lawoss_documents_export", "lawoss_documents_validate"].map((name) => [name, true]));
  const permissions = { "*": "deny", ...Object.fromEntries(Object.keys(tools).map((name) => [name, "allow"])) };
  const engineConfig = {
    enabled_providers: ["protected-documents"], model: `protected-documents/${model.id}`, small_model: `protected-documents/${model.id}`,
    share: "disabled", autoupdate: false, plugin: [`file://${BUNDLE}/plugin.mjs`], mcp: {}, lsp: false, formatter: false,
    tools: { "*": false, ...tools }, permission: permissions,
    compaction: { auto: false, prune: false },
    agent: { legalwork: { mode: "primary", description: "Protected LAWOSS document processing", permission: permissions, tools: { "*": false, ...tools } } },
    provider: { "protected-documents": { npm: "@ai-sdk/openai-compatible", name: "Protected documents",
      options: { baseURL: `${ORIGIN}/model`, apiKey: "guest-relay-no-upstream-credential" },
      models: { [model.id]: { name: typeof model.name === "string" ? model.name : model.id, limit: { context: model.context, output: model.output },
        ...(model.variants && typeof model.variants === "object" ? { variants: model.variants } : {}) } } } },
  };
  await writeFile(`${ROOT}/config/opencode.json`, JSON.stringify(engineConfig), { mode: 0o400 });
  const password = randomBytes(32).toString("hex");
  const authorization = "Basic " + Buffer.from(`opencode:${password}`).toString("base64");
  // Port reservation is released immediately before the private child starts;
  // the namespace contains only this worker and its trusted proxy.
  server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No private engine port");
  const port = address.port; await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  phase = "start-engine";
  child = spawn(`${ROOT}/bin/opencode`, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: `${ROOT}/workspace`, stdio: ["ignore", "ignore", "ignore"], shell: false,
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: ROOT, TMPDIR: `${ROOT}/tmp`, LANG: "C.UTF-8",
      XDG_CONFIG_HOME: `${ROOT}/config`, XDG_DATA_HOME: `${ROOT}/data`, XDG_STATE_HOME: `${ROOT}/state`, XDG_CACHE_HOME: `${ROOT}/cache`,
      OPENCODE_TEST_HOME: ROOT, OPENCODE_DB: `${ROOT}/engine.sqlite`, OPENCODE_CONFIG_DIR: `${ROOT}/config`, OPENCODE_CONFIG: `${ROOT}/config/opencode.json`,
      OPENCODE_SERVER_USERNAME: "opencode", OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_EXTERNAL_SKILLS: "true",
      OPENCODE_DISABLE_MODELS_FETCH: "true", OPENCODE_DISABLE_SHARE: "true", OPENCODE_DISABLE_AUTOUPDATE: "true", OPENCODE_DISABLE_AUTOCOMPACT: "true",
      OPENCODE_DISABLE_LSP_DOWNLOAD: "true", OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: "false",
      HTTP_PROXY: "http://127.0.0.1:3128", HTTPS_PROXY: "http://127.0.0.1:3128", http_proxy: "http://127.0.0.1:3128", https_proxy: "http://127.0.0.1:3128",
      NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", NODE_EXTRA_CA_CERTS: "/tmp/public/ca.pem", SSL_CERT_FILE: "/tmp/public/ca.pem",
    },
  });
  child.once("error", (error) => lifetime.abort(error));
  child.once("exit", () => lifetime.abort(new Error("Protected engine exited")));
  phase = "engine-health";
  const deadline = Date.now() + 120_000;
  while (true) {
    lifetime.signal.throwIfAborted();
    try {
      const health = await privateRequest(port, "/global/health", "GET", { authorization }, undefined, AbortSignal.any([lifetime.signal, AbortSignal.timeout(1000)]));
      const chunks = []; let size = 0;
      try { for await (const chunk of health) { size += chunk.length; if (size > 8192) throw new Error("Health body exceeds bound"); chunks.push(chunk); } }
      finally { health.destroy(); }
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      healthState = health.statusCode !== 200 ? "http-refused" : value.healthy !== true ? "invalid-health" : value.version !== "1.18.29" ? "version-mismatch" : "accepted";
      if (healthState === "accepted") break;
    } catch { healthState = "unreachable"; }
    if (Date.now() >= deadline) throw new Error("Private pinned engine did not become healthy");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  phase = "publish-ready";
  await capability("/rpc/ready", { version: 1 });
  phase = "serve";
  while (!lifetime.signal.aborted) {
    const command = await capability("/rpc/next");
    if (command?.kind === "idle") continue;
    if (command?.kind === "cancel") await execute(command, port, authorization);
    else void execute(command, port, authorization).catch((error) => lifetime.abort(error));
  }
}
process.once("SIGTERM", () => lifetime.abort(new Error("Worker stopped")));
process.once("SIGINT", () => lifetime.abort(new Error("Worker stopped")));
try { await start(); } catch { console.error(`Protected engine failed at ${phase}`); console.error(`Protected engine health state ${healthState}`); process.exitCode = 1; }
finally {
  lifetime.abort(); for (const controller of tasks.values()) controller.abort();
  if (child && child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await once(child, "close").catch(() => {}); }
  server?.close(); privateAgent.destroy();
}
