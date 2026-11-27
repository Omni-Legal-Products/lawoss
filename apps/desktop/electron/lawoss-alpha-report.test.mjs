import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_REPORT_ENDPOINT,
  buildReportForm,
  collectReportDiagnostics,
  createAlphaReportSession,
  createRedactor,
  keepUtf8Tail,
  normalizeReportFields,
  reportEndpoint,
  submitReport,
} from "./lawoss-alpha-report.mjs";
import { buildSupportBundleText, collectTechnicalSupportBundle } from "./support-bundle.mjs";

const HOME = "/Users/advokat";
const OFFICE = `${HOME}/Klienti`;
const CLIENT = `${OFFICE}/Novák s.r.o.`;
const PROFILE = `${HOME}/Library/Application Support/LAWOSS`;
const WIN_HOME = "C:\\Users\\Advokat";
const WIN_CLIENT = `${WIN_HOME}\\Documents\\Klienti\\Horváthová`;

const SECRETS = [
  "sk-or-v1-0123456789abcdefABCDEF0123",
  "sk-ant-api03-ZYXWVUTSRQPONMLKJIHG",
  "ghp_abcdefghijklmnopqrstuvwxyz0123",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0MTIzIn0.c2lnbmF0dXJlMTIz",
  "hunter2-heslo",
  "host-token-fixture-123",
  "proxyheslo",
  "bearer-fixture-abc",
  "querytoken123",
];
const PRIVATE = ["Novák", "Horváthová", "novak@klient.sk", "advokat", "Advokat", "Žaloba proti Novákovi"];

const redactor = createRedactor({ home: HOME, clientRoots: [CLIENT, OFFICE], profile: [[PROFILE, "<profile>"]] });
const winRedactor = createRedactor({ home: WIN_HOME, clientRoots: [WIN_CLIENT] });

function assertClean(text, { secrets = SECRETS, privateTerms = PRIVATE } = {}) {
  for (const secret of secrets) assert.ok(!text.includes(secret), `secret leaked: ${secret}`);
  for (const term of privateTerms) assert.ok(!text.includes(term), `private term leaked: ${term}`);
}

/** Realistický tvar exportu servera: runtime, logy so stackmi, konfigurácia MCP, workspaces podľa cesty. */
function technicalFixture() {
  return {
    format: "legalwork-technical-diagnostics",
    schemaVersion: 2,
    scope: { days: 7 },
    tokenCount: 123,
    workspaces: { [CLIENT]: { status: "ready" } },
    desktop: {
      runtime: {
        engine: { running: true, pid: 4242, cwd: CLIENT, env: { OPENROUTER_API_KEY: SECRETS[0], HOME } },
        provider: { apiKey: SECRETS[1], baseURL: "https://proxy:proxyheslo@example.test/v1" },
        github: { token: SECRETS[2] },
        session: SECRETS[3],
        hostToken: SECRETS[5],
      },
      logs: [{
        name: "main.log",
        lines: [
          `[2026-11-27T10:00:00.000Z] ENOENT: no such file '${CLIENT}/Žaloba proti Novákovi.docx'`,
          `  at open (${PROFILE}/app/server.js:10)`,
          `[2026-11-27T10:00:01.000Z] mail from novak@klient.sk failed, Authorization: Bearer ${SECRETS[7]}`,
          `[2026-11-27T10:00:02.000Z] GET https://api.example.test/x?token=${SECRETS[8]}&page=2`,
          `[2026-11-27T10:00:03.000Z] password=${SECRETS[4]} retry`,
          `[2026-11-27T10:00:04.000Z] opened ${HOME}/Desktop/Novák zmluva.pdf: ok`,
          `[2026-11-27T10:00:05.000Z] watch /Volumes/NAS/Advokat/Horváthová/spis.pdf`,
        ],
      }],
    },
  };
}

test("JSON diagnostics: no tokens, keys, passwords, e-mails or client paths, and the result still parses", async () => {
  const result = await collectReportDiagnostics({
    collectTechnical: async () => JSON.stringify(technicalFixture()),
    collectBasic: async () => { throw new Error("not used"); },
    redactor,
  });
  assert.equal(result.name, "lawoss-diagnostika.json");
  assertClean(result.content);
  const parsed = JSON.parse(result.content);
  assert.equal(parsed.tokenCount, 123, "numbers under secret-looking keys stay");
  assert.equal(parsed.desktop.runtime.engine.pid, 4242);
  assert.equal(parsed.desktop.runtime.engine.cwd, "<client-folder>");
  assert.deepEqual(Object.keys(parsed.workspaces), ["<client-folder>"]);
  assert.equal(parsed.desktop.runtime.engine.env.HOME, "~");
  const lines = parsed.desktop.logs[0].lines.join("\n");
  assert.match(lines, /<client-folder>\/<path>\.docx|<client-folder>\//);
  assert.match(lines, /<profile>\/app\/server\.js/);
  assert.match(lines, /<email>/);
  assert.match(lines, /ENOENT/, "the technical message stays readable");
});

test("Windows paths and JSON-escaped backslashes are shortened too", () => {
  const raw = JSON.stringify({ cwd: WIN_CLIENT, log: `failed ${WIN_CLIENT}\\spis.docx` }, null, 2);
  const text = winRedactor.redactText(`runtime ${raw}\nopened D:\\Kancelaria\\Novák\\zmluva.docx\nopened \\\\server\\share\\Novák\\a.pdf\nsystem C:\\Windows\\System32\\x.dll`);
  assertClean(text);
  assert.match(text, /<client-folder>/);
  assert.match(text, /<path>\.docx/);
  assert.match(text, /C:\\Windows\\System32/);
});

test("without the local service (boot error screen) the text support bundle is used and scrubbed", async () => {
  const logs = await mkdtemp(path.join(tmpdir(), "alpha-report-logs-"));
  try {
    await writeFile(path.join(logs, "main.log"), [
      `[2026-11-27T10:00:00.000Z] boot failed in ${CLIENT}/spis`,
      `OPENAI_API_KEY=${SECRETS[0]}`,
      `contact novak@klient.sk`,
    ].join("\n"));
    const app = { getName: () => "LAWOSS", getVersion: () => "0.2.1-alpha.27", isPackaged: true, getPath: () => logs };
    const runtimeManager = { collectRuntimeDiagnostics: async () => ({ engine: { cwd: CLIENT, token: SECRETS[5] } }), legalworkServerInfo: async () => ({ running: false }) };
    const result = await collectReportDiagnostics({
      collectTechnical: async () => collectTechnicalSupportBundle({ app, runtimeManager, serverInfo: await runtimeManager.legalworkServerInfo(), days: 3 }),
      collectBasic: () => buildSupportBundleText({ app, runtimeManager }),
      redactor: createRedactor({ home: HOME, clientRoots: [CLIENT], profile: [[logs, "<logs>"]] }),
    });
    assert.equal(result.name, "lawoss-diagnostika.txt");
    assert.match(result.content, /boot failed in <client-folder>/);
    assertClean(result.content, { secrets: [SECRETS[0], SECRETS[5]], privateTerms: ["Novák", "novak@klient.sk"] });
  } finally { await rm(logs, { recursive: true, force: true }); }
});

test("oversized diagnostics keep the newest end and fit the server limit", async () => {
  const big = JSON.stringify({ lines: Array.from({ length: 5000 }, (_, i) => `line ${i} ${"x".repeat(50)}`) });
  const result = await collectReportDiagnostics({ collectTechnical: async () => big, collectBasic: async () => "", redactor, limit: 20_000 });
  assert.equal(result.name, "lawoss-diagnostika.txt");
  assert.ok(Buffer.byteLength(result.content) <= 20_000);
  assert.match(result.content, /line 4999/);
  assert.ok(!result.content.includes("line 0 "));
  assert.equal(keepUtf8Tail("ščťž".repeat(10), 1000), "ščťž".repeat(10));
});

test("the multipart form matches the shared web interface", async () => {
  const fields = normalizeReportFields({ kind: "chyba", severity: "blokuje", what: "Otvoril som spis", outcome: "Appka spadla", repeat: "vzdy", contact: "tester@example.test", website: "bot" });
  const form = buildReportForm({ fields, version: "0.2.1-alpha.27.ga780d00", locale: "cs", platform: "win32", arch: "arm64", invite: "inv123",
    diagnostics: { name: "lawoss-diagnostika.json", type: "application/json", content: "{}" }, screenshot: Buffer.from([0x89, 0x50]) });
  const keys = [...new Set([...form.keys()])].sort();
  assert.deepEqual(keys, ["consent", "contact", "diagnostics", "files", "invite", "kind", "locale", "os", "outcome", "repeat", "severity", "source", "version", "what"]);
  assert.equal(form.get("source"), "app");
  assert.equal(form.get("consent"), "on");
  assert.equal(form.get("locale"), "cz");
  assert.equal(form.get("os"), "win-arm64");
  assert.equal(form.get("severity"), "blokuje");
  const diagnostics = form.get("diagnostics");
  const screenshot = form.get("files");
  assert.ok(diagnostics instanceof File && screenshot instanceof File);
  assert.equal(diagnostics.name, "lawoss-diagnostika.json");
  assert.equal(screenshot.name, "snimka-okna.png");
  assert.equal(screenshot.type, "image/png");

  const idea = buildReportForm({ fields: normalizeReportFields({ kind: "vylepsenie", severity: "blokuje", what: "Pridať export", repeat: "často" }), version: "1", locale: "en", platform: "darwin", arch: "arm64" });
  assert.equal(idea.get("severity"), null, "severity only for a bug");
  assert.equal(idea.get("repeat"), null, "unknown repeat values are dropped");
  assert.equal(idea.get("os"), "mac");
  assert.equal(idea.get("diagnostics"), null);
  assert.equal(idea.get("website"), null);
  assert.equal(buildReportForm({ fields, version: "1", locale: "sk", platform: "linux", arch: "x64" }).get("os"), "ine");
});

test("server errors, timeouts and network failures become codes without the response text", async () => {
  const form = new FormData();
  const reply = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  assert.deepEqual(await submitReport({ endpoint: "http://127.0.0.1:1/x", form, fetchImpl: reply(200, { ok: true, id: 42 }) }), { ok: true, id: 42 });
  assert.deepEqual(await submitReport({ endpoint: "x", form, fetchImpl: reply(429, { error: "rate_limited" }) }), { ok: false, code: "rate_limited" });
  assert.deepEqual(await submitReport({ endpoint: "x", form, fetchImpl: reply(400, { error: "file_type" }) }), { ok: false, code: "file_type" });
  assert.deepEqual(await submitReport({ endpoint: "x", form, fetchImpl: reply(503, { error: "storage_failed" }) }), { ok: false, code: "storage_failed" });
  assert.deepEqual(await submitReport({ endpoint: "x", form, fetchImpl: async () => new Response("<html>proxy</html>", { status: 413 }) }), { ok: false, code: "too_large" });
  assert.deepEqual(await submitReport({ endpoint: "x", form, fetchImpl: async () => new Response("bad gateway", { status: 502 }) }), { ok: false, code: "server" });
  assert.deepEqual(await submitReport({ endpoint: "x", form, fetchImpl: reply(400, { error: "something new" }) }), { ok: false, code: "unknown" });
  assert.deepEqual(await submitReport({ endpoint: "x", form, fetchImpl: async () => { throw new TypeError("fetch failed"); } }), { ok: false, code: "network" });
  const hang = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  assert.deepEqual(await submitReport({ endpoint: "x", form, fetchImpl: hang, timeoutMs: 20 }), { ok: false, code: "timeout" });
});

test("the server address is configurable only for https or this computer", () => {
  assert.equal(reportEndpoint({}), DEFAULT_REPORT_ENDPOINT);
  assert.equal(reportEndpoint({ LAWOSS_ALPHA_REPORT_URL: "http://127.0.0.1:4010/api/alfa/hlasenie" }), "http://127.0.0.1:4010/api/alfa/hlasenie");
  assert.equal(reportEndpoint({ LAWOSS_ALPHA_REPORT_URL: "https://staging.lawoss.app/api/alfa/hlasenie" }), "https://staging.lawoss.app/api/alfa/hlasenie");
  assert.equal(reportEndpoint({ LAWOSS_ALPHA_REPORT_URL: "http://evil.example/collect" }), DEFAULT_REPORT_ENDPOINT);
  assert.equal(reportEndpoint({ LAWOSS_ALPHA_REPORT_URL: "file:///etc/passwd" }), DEFAULT_REPORT_ENDPOINT);
});

test("session: the preview shows exactly the bytes that are sent, the screenshot is opt-in, state is released", async () => {
  let collected = 0;
  const sent = [];
  const session = createAlphaReportSession({
    captureWindow: async () => ({ png: Buffer.from("PNGDATA"), preview: "data:image/png;base64,AA" }),
    collectDiagnostics: async () => { collected++; return { name: "lawoss-diagnostika.json", type: "application/json", content: `{"n":${collected}}` }; },
    context: () => ({ version: "0.2.1-alpha.27", locale: "sk" }),
    endpoint: () => "http://127.0.0.1:4010/api/alfa/hlasenie",
    fetchImpl: async (url, init) => { sent.push({ url, form: init.body }); return Response.json({ ok: true, id: 7 }); },
  });
  const opened = await session.prepare({});
  assert.equal(opened.server, "127.0.0.1:4010");
  assert.equal(opened.screenshot, "data:image/png;base64,AA");
  const preview = await session.preview(opened.id);
  assert.equal(preview.text, '{"n":1}');
  assert.deepEqual(await session.submit(opened.id, { what: "abc" }), { ok: false, code: "invalid" });
  assert.equal(sent.length, 0);
  assert.deepEqual(await session.submit(opened.id, { what: "Spadlo to", includeDiagnostics: true, includeScreenshot: false }), { ok: true, id: 7 });
  assert.equal(collected, 1, "diagnostics are collected once");
  assert.equal(await sent[0].form.get("diagnostics").text(), '{"n":1}');
  assert.equal(sent[0].form.get("files"), null);
  await assert.rejects(session.preview(opened.id), /closed/, "a sent report releases its state");

  const again = await session.prepare({});
  await session.submit(again.id, { what: "So snímkou", includeScreenshot: true });
  assert.equal(Buffer.from(await sent[1].form.get("files").arrayBuffer()).toString(), "PNGDATA");
  assert.equal(sent[1].form.get("diagnostics"), null);
  session.discard(again.id);
  await assert.rejects(session.submit(again.id, { what: "po zatvorení" }), /closed/);
});

test("session: a failed send can be saved locally with the same diagnostics and screenshot", async () => {
  const savedFiles = [];
  const session = createAlphaReportSession({
    captureWindow: async () => ({ png: Buffer.from("PNG"), preview: "" }),
    collectDiagnostics: async () => ({ name: "lawoss-diagnostika.txt", type: "text/plain", content: "diag" }),
    context: () => ({ version: "1", locale: "cs" }),
    endpoint: () => DEFAULT_REPORT_ENDPOINT,
    fetchImpl: async () => { throw new TypeError("offline"); },
    saveFiles: async (files) => { savedFiles.push(files); return "/tmp/hlasenie.json"; },
  });
  const { id } = await session.prepare({});
  const input = { kind: "chyba", severity: "vazne", what: "Nefunguje export", includeDiagnostics: true, includeScreenshot: true };
  assert.deepEqual(await session.submit(id, input), { ok: false, code: "network" });
  assert.deepEqual(await session.save(id, input), { path: "/tmp/hlasenie.json" });
  const [saved] = savedFiles;
  const bundle = JSON.parse(saved.bundle);
  assert.equal(bundle.format, "lawoss-alpha-report");
  assert.equal(bundle.locale, "cz");
  assert.equal(bundle.what, "Nefunguje export");
  assert.equal(bundle.diagnostics.content, "diag");
  assert.equal(bundle.screenshot, "snimka-okna.png");
  assert.equal(saved.screenshot.toString(), "PNG");
});

test("client folders and their office folder are redacted, the home folder itself is not treated as a client", async () => {
  const { clientFolderRoots, requestAlphaReport } = await import("./lawoss-alpha-report-ipc.mjs");
  assert.deepEqual(clientFolderRoots([CLIENT, `${OFFICE}/Iný klient`, `${HOME}/Spis`, ""], HOME), [CLIENT, OFFICE, `${OFFICE}/Iný klient`, `${HOME}/Spis`]);
  const sent = [];
  const window = { isDestroyed: () => false, webContents: { isLoading: () => false, send: (channel) => sent.push(channel) } };
  let web = 0;
  assert.equal(requestAlphaReport({ window, openWeb: () => { web++; } }), "window");
  assert.deepEqual(sent, ["lawoss:alpha-report:open"]);
  assert.equal(requestAlphaReport({ window: null, openWeb: () => { web++; } }), "web");
  assert.equal(requestAlphaReport({ window: { ...window, webContents: { ...window.webContents, isLoading: () => true } }, openWeb: () => { web++; } }), "web");
  assert.equal(web, 2);
});
