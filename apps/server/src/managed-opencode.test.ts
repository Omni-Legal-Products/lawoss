import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createManagedOpencodeServer } from "./managed-opencode.js";

// A stand-in for the opencode binary: it fails the first
// FAKE_OPENCODE_FAIL_UNTIL starts with the same "database is locked" message a
// not-yet-reaped predecessor produces, then comes up healthy. Invocation count
// is tracked in a file so the test can assert how many attempts happened.
const FAKE_OPENCODE = `#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
const counter = process.env.FAKE_OPENCODE_COUNTER;
const failUntil = Number(process.env.FAKE_OPENCODE_FAIL_UNTIL || "0");
let n = 0;
try { n = Number(fs.readFileSync(counter, "utf8")) || 0; } catch {}
n += 1;
fs.writeFileSync(counter, String(n));
const portIdx = process.argv.indexOf("--port");
const port = portIdx >= 0 ? process.argv[portIdx + 1] : "0";
if (n <= failUntil) {
  process.stderr.write("Error: Unexpected error\\n\\ndatabase is locked\\n");
  process.exit(1);
}
process.stdout.write("opencode server listening on http://127.0.0.1:" + port + "\\n");
setTimeout(() => http.createServer((request, response) => {
  const expected = "Basic " + Buffer.from(process.env.OPENCODE_SERVER_USERNAME + ":" + process.env.OPENCODE_SERVER_PASSWORD).toString("base64");
  if (request.headers.authorization !== expected) return response.writeHead(401).end();
  if (request.url !== "/global/health") return response.writeHead(200).end("<html>UI</html>");
  const mode = process.env.FAKE_OPENCODE_HEALTH || "valid";
  response.on("close", () => fs.writeFileSync(counter + ".closed", "closed"));
  if (mode === "exit") { response.writeHead(200); response.write('{"healthy":'); return setTimeout(() => process.exit(1), 30); }
  if (mode === "idle") { response.writeHead(200); return response.write('{"healthy":'); }
  if (mode === "unauthorized") return response.writeHead(401).end();
  if (mode === "status") return response.writeHead(500).end('{"healthy":true,"version":"custom"}');
  const bodies = { html: "<html>UI</html>", shape: "null", malformed: "{", false: '{"healthy":false,"version":"custom"}', version: '{"healthy":true,"version":" "}', oversized: JSON.stringify({healthy:true,version:"x".repeat(17000)}), truncated: '{"healthy":true' };
  response.writeHead(200).end(bodies[mode] || JSON.stringify({healthy:true,version:"custom-build"}));
}).listen(Number(port), "127.0.0.1"), Number(process.env.FAKE_OPENCODE_LISTEN_DELAY_MS || "0"));
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1 << 30);
`;

let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function fakeBin(failUntil: number): { bin: string; counter: string } {
  dir = mkdtempSync(join(tmpdir(), "managed-opencode-"));
  const bin = join(dir, "fake-opencode");
  const counter = join(dir, "counter");
  writeFileSync(bin, FAKE_OPENCODE, "utf8");
  chmodSync(bin, 0o755);
  return { bin, counter };
}

test("retries the engine spawn while the DB is locked, then succeeds", async () => {
  const { bin, counter } = fakeBin(2); // fail twice, succeed on the 3rd
  const server = await createManagedOpencodeServer({
    bin,
    cwd: dir!,
    env: { FAKE_OPENCODE_COUNTER: counter, FAKE_OPENCODE_FAIL_UNTIL: "2" },
  });
  try {
    expect(server.url).toContain("http://127.0.0.1:");
    expect(server.running()).toBe(true);
    expect(Number(readFileSync(counter, "utf8"))).toBe(3); // 2 locked + 1 healthy
  } finally {
    await server.close();
  }
  expect(server.running()).toBe(false);
}, 20000);

test("waits for the HTTP listener even when the child announces readiness early", async () => {
  const { bin, counter } = fakeBin(0);
  const startedAt = Date.now();
  const server = await createManagedOpencodeServer({
    bin,
    cwd: dir!,
    env: { FAKE_OPENCODE_COUNTER: counter, FAKE_OPENCODE_LISTEN_DELAY_MS: "300" },
  });
  try {
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250);
    expect(server.running()).toBe(true);
  } finally {
    await server.close();
  }
}, 20000);

test("does NOT retry a non-lock start failure (fails fast)", async () => {
  // fail "forever" but with a lock message would retry; use a bin that exits
  // with a different error so the loop must give up on the first attempt.
  dir = mkdtempSync(join(tmpdir(), "managed-opencode-"));
  const bin = join(dir, "fake-opencode");
  const counter = join(dir, "counter");
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const counter = process.env.FAKE_OPENCODE_COUNTER;
let n = 0; try { n = Number(fs.readFileSync(counter, "utf8")) || 0; } catch {}
fs.writeFileSync(counter, String(n + 1));
process.stderr.write("Error: config parse failed\\n");
process.exit(1);
`,
    "utf8",
  );
  chmodSync(bin, 0o755);
  await expect(
    createManagedOpencodeServer({ bin, cwd: dir, env: { FAKE_OPENCODE_COUNTER: counter } }),
  ).rejects.toThrow(/config parse failed/);
  expect(Number(readFileSync(counter, "utf8"))).toBe(1); // exactly one attempt
}, 20000);

for (const mode of ["html", "status", "unauthorized", "shape", "malformed", "false", "version", "oversized", "truncated", "idle", "exit"]) {
  test(`rejects unhealthy HTTP response: ${mode}`, async () => {
    const { bin, counter } = fakeBin(0);
    const start = Date.now();
    await expect(createManagedOpencodeServer({
      bin, cwd: dir!, timeoutMs: 350,
      env: { FAKE_OPENCODE_COUNTER: counter, FAKE_OPENCODE_HEALTH: mode },
    }).then(async (server) => { await server.close(); return server; })).rejects.toThrow(/Timeout waiting|exited before/);
    expect(Date.now() - start).toBeLessThan(1500);
    expect(Number(readFileSync(counter, "utf8"))).toBe(1);
    if (mode === "idle") expect(readFileSync(counter + ".closed", "utf8")).toBe("closed");
  });
}
