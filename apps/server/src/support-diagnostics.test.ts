import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSupportDiagnostics, createDiagnosticRedactor } from "./support-diagnostics.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const privateMessage = "PRIVATE_USER_OR_ASSISTANT_MESSAGE_738126\nSecond line";
const privateReasoning = "PRIVATE_ASSISTANT_REASONING_824716";
const credential = "CREDENTIAL_VALUE_654321";
let root: string;
let databasePath: string;
let config: ServerConfig;
const prior = new Map<string, string | undefined>();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "support-diagnostics-"));
  databasePath = join(root, "opencode-engine.db");
  for (const name of ["OPENCODE_DB", "LEGALWORK_RUNTIME_DB", "LEGALWORK_TOKEN_STORE", "LEGALWORK_DATA_DIR"]) prior.set(name, process.env[name]);
  process.env.OPENCODE_DB = databasePath;
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json");
  process.env.LEGALWORK_DATA_DIR = root;
  config = { host: "127.0.0.1", port: 0, configPath: join(root, "server.json"), token: "client-fixture", hostToken: "host-fixture",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: true,
    startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
});
afterEach(async () => {
  for (const [name, value] of prior) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  await rm(root, { recursive: true, force: true });
});

function createDatabase() {
  const db = new Database(databasePath, { create: true });
  db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, project_id TEXT, title TEXT, time_created INTEGER, time_updated INTEGER); CREATE TABLE part (id TEXT PRIMARY KEY, session_id TEXT, message_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT); CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT); CREATE TABLE event (id TEXT PRIMARY KEY, aggregate_id TEXT, seq INTEGER, type TEXT, data TEXT)");
  db.query("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)").run("parent", null, "project-original", privateMessage, Date.now(), Date.now());
  db.query("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)").run("child", "parent", "project-original", privateMessage, Date.now(), Date.now());
  return db;
}
function part(db: Database, id: string, data: unknown, session = "parent", time = Date.now()) {
  db.query("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run(id, session, "message-original", time, time, JSON.stringify(data));
}

test("keeps real tool details and full errors while omitting message/reasoning bodies, summaries and attachment bytes", async () => {
  const db = createDatabase();
  part(db, "text", { type: "text", text: privateMessage });
  part(db, "reasoning", { type: "reasoning", text: privateReasoning });
  part(db, "file", { type: "file", filename: "contract.docx", mime: "application/docx", url: "data:private-bytes", source: { text: { value: privateMessage } } });
  part(db, "call", { type: "tool", callID: "call-original", tool: "legalwork_inapp_docx_find_text", state: { status: "error",
    input: { query: null, offset: 900, filePath: "/matters/contract.docx", customOption: "retain useful detail", api_key: credential },
    error: "Offset 900 is out of range for /matters/contract.docx (only 1 line)", metadata: { open: false, outputPath: "/tool-output/call-original" }, time: { start: 100, end: 150 } } });
  db.query("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run("message-original", "parent", Date.now(), Date.now(), JSON.stringify({ role: "assistant", time: { created: 100, completed: 150 },
    modelID: "claude-sonnet", tokens: { input: 123, output: 456 }, structured: { answer: privateMessage }, system: privateMessage, summary: { body: privateMessage } }));
  db.close();
  const before = await readFile(databasePath);
  const report = await collectSupportDiagnostics(config);
  const text = JSON.stringify(report);
  for (const body of [privateMessage.split("\n")[0], privateReasoning, credential, "data:private-bytes"]) expect(text).not.toContain(body);
  expect(report.counts).toMatchObject({ sessions: 2, messages: 1, parts: 4 });
  for (const detail of ["legalwork_inapp_docx_find_text", "query\":null", "offset\":900", "retain useful detail", "only 1 line", "contract.docx", "claude-sonnet", "\"input\":123", "call-original", "message-original"]) expect(text).toContain(detail);
  expect(await readFile(databasePath)).toEqual(before);
});

test("exports general traces: steps, retries, compaction, model errors and ordered persisted state transitions", async () => {
  const db = createDatabase();
  part(db, "step", { type: "step-finish", reason: "tool-calls", tokens: { input: 700, output: 200 }, cost: 0.1 });
  part(db, "retry", { type: "retry", attempt: 2, error: { name: "APIError", data: { message: "rate limit", statusCode: 429, isRetryable: true } } });
  part(db, "compact", { type: "compaction", auto: true, overflow: true });
  db.query("INSERT INTO event VALUES (?, ?, ?, ?, ?)").run("ev2", "parent", 2, "message.part.updated.1", JSON.stringify({ sessionID: "parent", part: { id: "text", type: "text", text: privateMessage }, time: Date.now() }));
  db.query("INSERT INTO event VALUES (?, ?, ?, ?, ?)").run("ev1", "parent", 1, "session.updated.1", JSON.stringify({ sessionID: "parent", info: { id: "parent", title: privateMessage, time: { updated: Date.now() } } }));
  db.close();
  const report = await collectSupportDiagnostics(config);
  const text = JSON.stringify(report);
  expect(report).toMatchObject({ events: [{ sequence: 1, type: "session.updated.1" }, { sequence: 2, type: "message.part.updated.1" }], counts: { parts: 3 } });
  for (const detail of ["step-finish", "tool-calls", "rate limit", "429", "isRetryable"]) expect(text).toContain(detail);
  expect(text).not.toContain(privateMessage.split("\n")[0]);
});

test("runtime logs retain errors and stack traces but remove exact message copies and credentials", async () => {
  const db = createDatabase();
  part(db, "text", { type: "text", text: privateMessage });
  part(db, "reasoning", { type: "reasoning", text: privateReasoning });
  db.close();
  const report = await collectSupportDiagnostics(config, Date.now(), { runtime: { running: true, pid: 1234, hostToken: credential, lastStderr: "ECONNRESET at bridge.ts:100" },
    logs: [{ content: `request ${JSON.stringify(privateMessage)}\n${privateReasoning}\nUI bridge unreachable\n  at bridge.ts:100\nauthorization: Bearer ${credential}` }] });
  const text = JSON.stringify(report);
  for (const value of [privateMessage.split("\n")[0], privateReasoning, credential]) expect(text).not.toContain(value);
  for (const value of ["1234", "ECONNRESET", "bridge.ts:100", "UI bridge unreachable"]) expect(text).toContain(value);
});

test("redacts credentials in nested JSON outputs and role-bearing payloads while preserving token counts", () => {
  const redactor = createDiagnosticRedactor(["yes"]);
  const text = JSON.stringify(redactor.clean({ output: JSON.stringify({ result: { access_token: credential }, messages: [{ role: "assistant", content: privateMessage }] }),
    tokens: { input: 123 }, prompt: "yes", id: "yes-id", error: `https://user:${credential}@example.com/failed`, apiKey: credential,
    headers: { "X-LegalWork-Host-Token": credential, "X-Api-Key": credential }, password: 987654321 }));
  expect(text).not.toContain(credential);
  expect(text).not.toContain("987654321");
  expect(text).not.toContain(privateMessage.split("\n")[0]);
  expect(text).toContain("yes-id");
  expect(text).toContain("\"input\":123");
});

test("reports truncation while retaining both the start of a large result and its byte omission count", async () => {
  const db = createDatabase();
  part(db, "large", { type: "tool", tool: "read", state: { status: "completed", output: "useful output ".repeat(30000) } });
  db.close();
  const report = await collectSupportDiagnostics(config);
  expect(report.truncation.truncatedStrings).toBe(1);
  expect(JSON.stringify(report)).toContain("useful output");
  expect(JSON.stringify(report)).toContain("bytes omitted");
});

test("only includes recently active sessions; a missing database still allows runtime diagnostics", async () => {
  const db = createDatabase();
  db.query("UPDATE session SET time_updated = 0 WHERE id = 'child'").run();
  db.close();
  expect((await collectSupportDiagnostics(config)).counts.sessions).toBe(1);
  await rm(databasePath);
  expect(await collectSupportDiagnostics(config, Date.now(), { runtime: { running: false, lastStderr: "engine exited with code 1" } })).toMatchObject({
    sources: { database: "missing" }, desktop: { runtime: { running: false, lastStderr: "engine exited with code 1" } }, counts: { sessions: 0 } });
  expect(existsSync(databasePath)).toBe(false);
});

test("reads a consistent snapshot including committed WAL data without changing the database", async () => {
  const db = createDatabase();
  db.exec("PRAGMA journal_mode = WAL");
  part(db, "wal-call", { type: "tool", tool: "task", state: { status: "running", input: { description: "compare files" } } });
  const report = await collectSupportDiagnostics(config);
  expect(JSON.stringify(report)).toContain("wal-call");
  expect(db.query("SELECT count(*) AS count FROM part").get()).toEqual({ count: 1 });
  db.close();
});

test("days defaults to seven and a shorter period excludes older sessions, parts and timestamped events", async () => {
  const db = createDatabase();
  const now = Date.now();
  const old = now - 2 * 86400000;
  db.query("UPDATE session SET time_updated = ? WHERE id = 'child'").run(old);
  part(db, "old", { type: "tool", tool: "read", state: {} }, "parent", old);
  part(db, "recent", { type: "tool", tool: "read", state: {} }, "parent", now);
  db.query("INSERT INTO event VALUES (?, ?, ?, ?, ?)").run("old-event", "parent", 1, "session.updated.1", JSON.stringify({ info: { time: { updated: old } } }));
  db.query("INSERT INTO event VALUES (?, ?, ?, ?, ?)").run("new-event", "parent", 2, "session.updated.1", JSON.stringify({ info: { time: { updated: now } } }));
  db.query("INSERT INTO event VALUES (?, ?, ?, ?, ?)").run("undated-event", "parent", 3, "message.removed.1", JSON.stringify({ messageID: "removed" }));
  db.close();
  expect(await collectSupportDiagnostics(config, now)).toMatchObject({ scope: { days: 7 }, counts: { sessions: 2, parts: 2, events: 3 } });
  const report = await collectSupportDiagnostics(config, now, null, 1);
  expect(report).toMatchObject({ scope: { days: 1, sessionsActiveSince: new Date(now - 86400000).toISOString() }, counts: { sessions: 1, parts: 1, events: 2 } });
  expect(JSON.stringify(report)).not.toContain('"id":"old-event"');
  for (const invalid of [null, 0, -1, 1.5, 366, "7"]) await expect(collectSupportDiagnostics(config, now, null, invalid)).rejects.toThrow("whole number");
});

test("the export is host-only, including when a valid ordinary client token is supplied", async () => {
  const server = await startServer(config);
  try {
    const url = `http://127.0.0.1:${server.port}/diagnostics/export`;
    expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(401);
    expect((await fetch(url, { method: "POST", body: "{}", headers: { authorization: `Bearer ${config.token}` } })).status).toBe(401);
    const response = await fetch(url, { method: "POST", body: JSON.stringify({ desktop: { runtime: { pid: 1234, hostToken: credential } } }), headers: { "X-LegalWork-Host-Token": config.hostToken } });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("1234");
    expect(text).not.toContain(credential);
    expect(JSON.parse(text)).toMatchObject({ scope: { days: 7 } });
    const custom = await fetch(url, { method: "POST", body: JSON.stringify({ days: 30 }), headers: { "X-LegalWork-Host-Token": config.hostToken } });
    expect(await custom.json()).toMatchObject({ scope: { days: 30 } });
    const invalid = await fetch(url, { method: "POST", body: JSON.stringify({ days: 1.5 }), headers: { "X-LegalWork-Host-Token": config.hostToken } });
    expect(invalid.status).toBe(400);
  } finally { await server.stop(); }
});
