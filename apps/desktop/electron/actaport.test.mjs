import assert from "node:assert/strict";
import { test } from "node:test";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createActaportConnection, prepareActaportRuntime } from "./actaport.mjs";

const credentials = { realm: "test-firm", clientId: "client", clientSecret: "private-secret", username: "api-user", password: "private-password" };
const loadAuth = () => import(new URL("../../../packages/actaport-mcp/dist/auth.mjs", import.meta.url).href);
/** @returns {Pick<typeof import('electron').safeStorage, 'isEncryptionAvailable' | 'encryptString' | 'decryptString' | 'getSelectedStorageBackend'>} */
function storage() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]);
    },
    decryptString(buffer) {
      const cipher = createDecipheriv("aes-256-gcm", key, buffer.subarray(0, 12));
      cipher.setAuthTag(buffer.subarray(buffer.length - 16));
      return Buffer.concat([cipher.update(buffer.subarray(12, buffer.length - 16)), cipher.final()]).toString("utf8");
    },
  };
}
const providerFetch = async (url, init) => {
  assert.equal(init.redirect, "error");
  if (String(url).includes("/openid-connect/token")) return Response.json({ access_token: "private-token", expires_in: 300 });
  assert.equal(init.headers.Authorization, "Bearer private-token");
  return Response.json({ id: "user" });
};

test("credentials are encrypted; the private bridge releases tokens only and revokes on disconnect", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "legalwork-actaport-"));
  const safeStorage = storage();
  const connection = createActaportConnection({ directory, safeStorage, loadAuth, fetch: providerFetch });
  try {
    assert.equal((await connection.status()).configured, false);
    const connected = await connection.connect(credentials);
    assert.equal(connected.configured, true);
    assert.equal(connected.allowWrites, false);
    assert.deepEqual(connected.enabledToolsets, []);
    assert.equal(connected.coreToolCount, 15);
    assert.equal(connected.toolsets.length, 4);
    const encrypted = await readFile(path.join(directory, "actaport-credentials.enc"));
    assert.equal(encrypted.includes(Buffer.from("private-password")), false);
    assert.equal(encrypted.includes(Buffer.from("private-secret")), false);
    if (process.platform !== "win32") assert.equal((await stat(path.join(directory, "actaport-credentials.enc"))).mode & 0o777, 0o600);
    const environment = await connection.environment();
    assert.equal(environment.ACTAPORT_ALLOW_WRITES, "0");
    assert.equal(JSON.stringify(environment).includes("private-password"), false);
    const descriptor = JSON.parse(await readFile(environment.ACTAPORT_CONNECTION_FILE, "utf8"));
    assert.equal((await fetch(`${descriptor.baseUrl}token`, { method: "POST" })).status, 401);
    const headers = { Authorization: `Bearer ${descriptor.token}`, "Content-Type": "application/json" };
    assert.equal((await fetch(`${descriptor.baseUrl}token`, { method: "POST", headers: { ...headers, Origin: "https://attacker.example" } })).status, 401);
    let response = await fetch(`${descriptor.baseUrl}token`, { method: "POST", headers, body: "{}" });
    const result = await response.json();
    assert.deepEqual(Object.keys(result).sort(), ["accessToken", "allowWrites", "expiresAt", "toolsets"]);
    assert.equal(result.accessToken, "private-token");
    assert.equal(result.allowWrites, false);
    await connection.setWriteAccess(true);
    assert.equal((await connection.environment()).ACTAPORT_ALLOW_WRITES, "1");
    response = await fetch(`${descriptor.baseUrl}token`, { method: "POST", headers, body: "{}" });
    assert.equal((await response.json()).allowWrites, true);
    const restored = createActaportConnection({ directory, safeStorage, loadAuth, fetch: providerFetch });
    assert.equal((await restored.status()).configured, true);
    await connection.disconnect();
    assert.equal((await restored.status()).configured, false);
    assert.equal((await fetch(`${descriptor.baseUrl}token`, { method: "POST", headers, body: "{}" })).status, 409);
  } finally { await connection.close(); await rm(directory, { recursive: true, force: true }); }
});

test("Linux plaintext fallback and invalid credentials cannot be saved", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "legalwork-actaport-insecure-"));
  /** @type {ReturnType<typeof storage>} */
  const safeStorage = { ...storage(), getSelectedStorageBackend: () => "basic_text" };
  const connection = createActaportConnection({ directory, safeStorage, loadAuth, fetch: providerFetch, platform: "linux" });
  try {
    assert.equal((await connection.status()).secureStorage, false);
    await assert.rejects(connection.connect(credentials), /Secure credential storage/);
    await assert.rejects(readFile(path.join(directory, "actaport-credentials.enc")), { code: "ENOENT" });
  } finally { await connection.close(); await rm(directory, { recursive: true, force: true }); }
});

test("tool groups persist privately, survive permission changes and revoke through the bridge", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "legalwork-actaport-groups-"));
  const safeStorage = storage();
  const connection = createActaportConnection({ directory, safeStorage, loadAuth, fetch: providerFetch });
  try {
    await connection.connect(credentials);
    const environment = await connection.environment();
    assert.equal(environment.ACTAPORT_TOOLSETS, "");
    const descriptor = JSON.parse(await readFile(environment.ACTAPORT_CONNECTION_FILE, "utf8"));
    const access = async () => (await fetch(`${descriptor.baseUrl}token`, { method: "POST",
      headers: { Authorization: `Bearer ${descriptor.token}` }, body: "{}" })).json();
    await access(); // Initialise the live token cache before changing settings.
    assert.deepEqual((await connection.setToolsets(["finance", "uploads"])).enabledToolsets, ["finance", "uploads"]);
    assert.deepEqual((await access()).toolsets, ["finance", "uploads"]);
    assert.equal((await connection.environment()).ACTAPORT_TOOLSETS, "finance,uploads");
    const changed = await connection.setWriteAccess(true);
    assert.deepEqual(changed.enabledToolsets, ["finance", "uploads"]);
    const restored = createActaportConnection({ directory, safeStorage, loadAuth, fetch: providerFetch });
    assert.deepEqual((await restored.status()).enabledToolsets, ["finance", "uploads"]);
    await assert.rejects(connection.setToolsets(["unknown"]), /valid Actaport tool groups/);
    await assert.rejects(connection.setToolsets(["finance", "finance"]), /valid Actaport tool groups/);
    assert.deepEqual((await connection.status()).enabledToolsets, ["finance", "uploads"]);
    await connection.setToolsets([]);
    assert.deepEqual((await access()).toolsets, []);
    assert.equal((await access()).allowWrites, true);
    // Replacing credentials starts again with the small read-only set.
    const replaced = await connection.connect(credentials);
    assert.deepEqual(replaced.enabledToolsets, []);
    assert.equal(replaced.allowWrites, false);
  } finally { await connection.close(); await rm(directory, { recursive: true, force: true }); }
});

test("credentials saved before tool groups were introduced migrate to the minimal set", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "legalwork-actaport-legacy-"));
  const safeStorage = storage();
  const connection = createActaportConnection({ directory, safeStorage, loadAuth, fetch: providerFetch });
  try {
    await writeFile(path.join(directory, "actaport-credentials.enc"), safeStorage.encryptString(JSON.stringify({ credentials, allowWrites: true })), { mode: 0o600 });
    const saved = await connection.status();
    assert.equal(saved.configured, true);
    assert.equal(saved.allowWrites, true);
    assert.deepEqual(saved.enabledToolsets, []);
    assert.equal((await connection.environment()).ACTAPORT_TOOLSETS, "");
  } finally { await connection.close(); await rm(directory, { recursive: true, force: true }); }
});

test("macOS does not call the Linux-only storage backend API", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "legalwork-actaport-macos-"));
  const safeStorage = { ...storage(), getSelectedStorageBackend: () => { throw new Error("Linux only"); } };
  const connection = createActaportConnection({ directory, safeStorage, loadAuth, fetch: providerFetch, platform: "darwin" });
  try { assert.equal((await connection.connect(credentials)).configured, true); }
  finally { await connection.close(); await rm(directory, { recursive: true, force: true }); }
});

test("bundled runtime has a stable path and updates when the application moves or upgrades", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "legalwork-actaport-runtime-"));
  try {
    const first = path.join(root, "app-v1");
    const second = path.join(root, "app-v2");
    const destination = path.join(root, "user-data", "mcp", "actaport");
    for (const [source, version] of [[first, "v1"], [second, "v2"]]) {
      await mkdir(source);
      await writeFile(path.join(source, "index.mjs"), version);
      await writeFile(path.join(source, "auth.mjs"), version);
    }
    const entry = await prepareActaportRuntime(first, destination);
    assert.equal(await readFile(entry, "utf8"), "v1");
    assert.equal(await prepareActaportRuntime(second, destination), entry);
    assert.equal(await readFile(entry, "utf8"), "v2");
    assert.equal(await readFile(path.join(destination, "auth.mjs"), "utf8"), "v2");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("publishing the private discovery file replaces a symlink without writing its target", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "legalwork-actaport-discovery-"));
  const outside = path.join(directory, "other-file.json");
  const discovery = path.join(directory, "actaport-connection.json");
  const connection = createActaportConnection({ directory, safeStorage: storage(), loadAuth, fetch: providerFetch });
  try {
    await writeFile(outside, "preserve this file", { mode: 0o644 });
    await symlink(outside, discovery);
    await connection.environment();
    assert.equal(await readFile(outside, "utf8"), "preserve this file");
    assert.equal(typeof JSON.parse(await readFile(discovery, "utf8")).token, "string");
    if (process.platform !== "win32") assert.equal((await stat(discovery)).mode & 0o777, 0o600);
  } finally { await connection.close(); await rm(directory, { recursive: true, force: true }); }
});
