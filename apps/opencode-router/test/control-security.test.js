import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startHealthServer } from "../dist/health.js";
import { loadConfig } from "../dist/config.js";

const controlToken = "af".repeat(32);
const snapshot = { ok: true, opencode: { url: "http://private-engine:4096", healthy: true }, channels: { telegram: true, whatsapp: false, slack: false }, config: { groupsEnabled: false }, agent: { scope: "workspace", path: "/private/workspace/agent.md", loaded: true } };

function request(port, route, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: route, method: options.method ?? "GET", headers: options.headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end(options.body);
  });
}

async function fixture(t) {
  let port;
  const calls = [];
  const record = (name, result) => async (value) => { calls.push({ name, value }); return result; };
  const logger = { info(data) { if (data.port) port = data.port; }, error() {} };
  const stop = await startHealthServer(0, () => snapshot, logger, {
    getGroupsEnabled: () => false,
    setGroupsEnabled: record("groups", { groupsEnabled: true }),
    listTelegramIdentities: record("listTelegram", { items: [] }),
    listSlackIdentities: record("listSlack", { items: [] }),
    upsertTelegramIdentity: record("telegram", { id: "default", enabled: true }),
    upsertSlackIdentity: record("slack", { id: "default", enabled: true }),
    deleteTelegramIdentity: record("deleteTelegram", { id: "default", deleted: true }),
    deleteSlackIdentity: record("deleteSlack", { id: "default", deleted: true }),
    listBindings: record("listBindings", { items: [] }),
    setBinding: record("setBinding"), clearBinding: record("clearBinding"),
    sendMessage: record("send", { channel: "slack", directory: ".", attempted: 1, sent: 1 }),
  }, { controlToken });
  t.after(stop);
  return { port, calls };
}

test("router refuses startup without a provisioned private control capability", async () => {
  for (const token of [undefined, "short", "x".repeat(64)]) {
    await assert.rejects(startHealthServer(0, () => snapshot, { info() {} }, {}, { controlToken: token }), /CONTROL_TOKEN/);
  }
});

test("router liveness stays public but never leaks status, directories or credentials", async (t) => {
  const { port } = await fixture(t);
  for (const route of ["/", "/health"]) {
    const publicResult = await request(port, route);
    assert.equal(publicResult.status, 200);
    assert.deepEqual(JSON.parse(publicResult.body), { ok: true });
    const privateResult = await request(port, route, { headers: { Authorization: `Bearer ${controlToken}` } });
    assert.equal(privateResult.status, 200);
    assert.deepEqual(JSON.parse(privateResult.body), snapshot);
    assert.equal((await request(port, route, { method: "HEAD" })).body, "");
    assert.equal((await request(port, route, { method: "POST" })).status, 401);
    assert.equal((await request(port, route, { headers: { Authorization: "Bearer invalid" } })).status, 401);
  }
});

test("every control route rejects requests before parsing or calling handlers", async (t) => {
  const { port, calls } = await fixture(t);
  const routes = [
    ["POST", "/config/telegram-token"], ["POST", "/config/slack-tokens"],
    ["GET", "/identities/telegram"], ["POST", "/identities/telegram"], ["DELETE", "/identities/telegram/default"],
    ["GET", "/identities/slack"], ["POST", "/identities/slack"], ["DELETE", "/identities/slack/default"],
    ["GET", "/config/groups"], ["POST", "/config/groups"], ["GET", "/bindings"], ["POST", "/bindings"], ["POST", "/send"],
    ["OPTIONS", "/send"],
  ];
  for (const [method, route] of routes) {
    for (const authorization of [undefined, `Bearer ${"ba".repeat(32)}`, "Basic wrong"]) {
      const headers = authorization ? { Authorization: authorization } : {};
      const response = await request(port, route, { method, headers, body: method === "POST" ? "invalid json" : undefined });
      assert.equal(response.status, 401, `${method} ${route}`);
      assert.equal(response.headers["access-control-allow-origin"], undefined);
    }
  }
  assert.deepEqual(calls, []);
  const result = await request(port, "/send", { method: "POST", headers: { Authorization: `Bearer ${controlToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ channel: "slack", text: "test", peerId: "mock-peer" }) });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "send");
});

test("browser origins, private-network preflights and DNS rebinding are denied even with a valid capability", async (t) => {
  const { port, calls } = await fixture(t);
  for (const headers of [
    { Origin: "https://attacker.invalid" }, { Origin: "null" }, { Origin: `http://localhost:${port}` },
    { Host: `attacker.invalid:${port}` }, { Host: `127.0.0.1:${port + 1}` },
    { Origin: "https://attacker.invalid", "Access-Control-Request-Private-Network": "true" },
  ]) {
    const result = await request(port, "/send", { method: "OPTIONS", headers: { ...headers, Authorization: `Bearer ${controlToken}` } });
    assert.equal(result.status, 403);
    assert.equal(result.headers["access-control-allow-private-network"], undefined);
  }
  assert.deepEqual(calls, []);
});

test("standalone configuration takes the control capability from private environment only", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "router-config-security-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, "router.json");
  await fs.writeFile(configPath, JSON.stringify({ version: 1 }));
  const config = loadConfig({ OPENCODE_ROUTER_CONFIG_PATH: configPath, OPENCODE_ROUTER_CONTROL_TOKEN: controlToken });
  assert.equal(config.controlToken, controlToken);
  assert.equal(JSON.stringify(config.configFile).includes(controlToken), false);
  assert.equal((await fs.readFile(configPath, "utf8")).includes(controlToken), false);
});
