// LAWOSS N-A7-8: most UI spustí akciu editora, ktorá zapisuje, len s hlavičkou servera; každá akcia
// dokumentových plôch v appke je zaradená, takže nová akcia editora nezostane mimo zoznamu.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { EDITOR_OTHER_ACTIONS, EDITOR_WRITE_ACTIONS, EDITOR_WRITE_HEADER } from "./lawoss-editor-write-gate.mjs";
import { createUiControlServer } from "./ui-control-server.mjs";

async function startBridge(t) {
  const root = await mkdtemp(path.join(tmpdir(), "lawoss-editor-gate-"));
  const executed = [];
  const bridge = createUiControlServer({
    appName: "test", appIdentifier: "test", getUserDataDir: () => root,
    getWindow: async () => ({
      show: () => {}, isMinimized: () => false, restore: () => {}, focus: () => {},
      webContents: { executeJavaScript: async (expression) => { executed.push(expression); return { ok: true, result: { ok: true } }; } },
    }),
  });
  t.after(async () => { await bridge.stop(); await rm(root, { recursive: true, force: true }); });
  await bridge.start();
  const { baseUrl, token } = JSON.parse(await readFile(path.join(root, "legalwork-ui-control.json"), "utf8"));
  const execute = async (body, approved = false) => (await fetch(`${baseUrl}/execute`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(approved ? { [EDITOR_WRITE_HEADER]: "1" } : {}) },
    body: JSON.stringify(body),
  })).json();
  return { execute, executed };
}

test("an editor write without the server's header is refused before it reaches the app", async (t) => {
  const { execute, executed } = await startBridge(t);
  for (const body of [
    ...EDITOR_WRITE_ACTIONS.map((actionId) => ({ actionId, args: { sessionId: "ses_1" } })),
    { actionId: "documents.open", args: { sessionId: "ses_1", path: "Sablona.docx", copyTo: "Spisy/M004-syn/Kopia.docx" } },
  ]) {
    const result = await execute(body);
    assert.equal(result.ok, false, body.actionId);
    assert.match(result.error, /inapp_\* document tools/);
  }
  assert.deepEqual(executed, []);
});

test("the server's approved editor calls and other actions still run", async (t) => {
  const { execute, executed } = await startBridge(t);
  for (const actionId of EDITOR_WRITE_ACTIONS) assert.equal((await execute({ actionId, args: { sessionId: "ses_1" } }, true)).ok, true);
  assert.equal((await execute({ actionId: "documents.open", args: { sessionId: "ses_1", path: "Sablona.docx", copyTo: "Kopia.docx" } }, true)).ok, true);
  assert.equal((await execute({ actionId: "documents.open", args: { sessionId: "ses_1", path: "Zmluva.docx" } })).ok, true);
  assert.equal((await execute({ actionId: "documents.list", args: { sessionId: "ses_1" } })).ok, true);
  assert.equal((await execute({ actionId: "settings.panel.open", args: { panel: "general" } })).ok, true);
  assert.equal(executed.length, EDITOR_WRITE_ACTIONS.length + 4);
});

// Control actions the app registers: every id in the document panels, and any document/markdown/office id elsewhere.
const appSource = fileURLToPath(new URL("../../app/src/", import.meta.url));
const ARTIFACTS = path.join("react-app", "domains", "session", "artifacts");
const NOT_EDITOR = ["browser.open_url", "browser.set_proxy", "session.open", "session.read_transcript"];
const ACTION_ID = /\bid:\s*(?:[^,\n{}]*?\?\s*)?"([a-z_]+\.[a-z_.]+)"(?:\s*:\s*"([a-z_]+\.[a-z_.]+)")?/g;

async function registeredActionIds() {
  const ids = new Set();
  for (const entry of await readdir(appSource, { recursive: true })) {
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
    const source = await readFile(path.join(appSource, entry), "utf8");
    if (!/useControlActions?\(|LegalworkControlAction\b/.test(source)) continue;
    for (const match of source.matchAll(ACTION_ID)) for (const id of match.slice(1).filter(Boolean)) {
      if (entry.startsWith(ARTIFACTS) || /^(document|documents|markdown|office)\./.test(id)) ids.add(id);
    }
  }
  return [...ids].sort();
}

test("every document action the app registers is classified as an editor write or not", async () => {
  const ids = await registeredActionIds();
  assert.ok(ids.includes("document.agent_tool") && ids.includes("documents.begin_file_edit"), "the scan must see the editor actions");
  assert.deepEqual(ids, [...EDITOR_WRITE_ACTIONS, ...EDITOR_OTHER_ACTIONS, ...NOT_EDITOR].sort(),
    "A new document action must be added to EDITOR_WRITE_ACTIONS (it saves a file) or EDITOR_OTHER_ACTIONS in lawoss-editor-write-gate.mjs.");
});
