import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { seedOpencodeSessionMessages } from "../dist/opencode-db.js";

// Exercise the real better-sqlite3 binding: Bun skips this native boundary.
test("built session seed discovers the matching DB, binds every statement and preserves replay", async (context) => {
  const root = await mkdtemp(join(os.tmpdir(), "lawoss-session-seed-node-"));
  const directory = join(root, "opencode");
  await mkdir(directory);
  const dbPath = join(directory, "opencode.db");
  const earlier = new DatabaseSync(join(directory, "opencode-local.db"));
  earlier.exec("CREATE TABLE session (id TEXT PRIMARY KEY); INSERT INTO session VALUES ('other-session');");
  earlier.close();
  const previous = Object.fromEntries(["XDG_DATA_HOME", "LEGALWORK_DATA_DIR", "OPENCODE_CHANNEL", "OPENCODE_DB", "OPENCODE_DISABLE_CHANNEL_DB", "APPDATA"].map(key => [key, process.env[key]]));
  Object.assign(process.env, { XDG_DATA_HOME: root, LEGALWORK_DATA_DIR: root, OPENCODE_CHANNEL: "local", APPDATA: root });
  delete process.env.OPENCODE_DB;
  delete process.env.OPENCODE_DISABLE_CHANNEL_DB;
  // Even a broken discovery must never inspect the developer's profile DB.
  context.mock.method(os, "homedir", () => root);
  syncBuiltinESMExports();
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, time_updated INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
        time_created INTEGER, time_updated INTEGER, data TEXT NOT NULL);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL,
        session_id TEXT NOT NULL, time_created INTEGER, time_updated INTEGER, data TEXT NOT NULL);
      INSERT INTO session VALUES ('synthetic-session', 1);
    `);
    const input = {
      sessionId: "synthetic-session", workspaceRoot: root, now: 1700000000000,
      messages: [
        { role: "assistant", text: "Welcome" },
        { role: "user", text: "Synthetic request" },
        { role: "assistant", text: "Synthetic response" },
      ],
    };
    assert.deepEqual(seedOpencodeSessionMessages(input), { inserted: 3, skipped: false });
    const snapshot = () => ({
      messages: db.prepare("SELECT * FROM message ORDER BY time_created").all(),
      parts: db.prepare("SELECT * FROM part ORDER BY time_created").all(),
      sessions: db.prepare("SELECT * FROM session").all(),
    });
    const seeded = snapshot();
    const decoded = seeded.messages.map(row => JSON.parse(row.data));
    assert.deepEqual(decoded.map(message => message.role), ["assistant", "user", "assistant"]);
    assert.equal(decoded[0].parentID, seeded.messages[0].id);
    assert.equal(decoded[2].parentID, seeded.messages[1].id);
    assert.deepEqual(seeded.parts.map(part => part.message_id), seeded.messages.map(message => message.id));
    assert.deepEqual(seeded.parts.map(part => JSON.parse(part.data)), input.messages.map(message => ({ type: "text", text: message.text })));
    assert.equal(seeded.sessions[0].time_updated, input.now + 3);
    assert.deepEqual(seedOpencodeSessionMessages({ ...input, dbPath, messages: [{ role: "user", text: "Must not overwrite" }] }), { inserted: 0, skipped: true });
    assert.deepEqual(snapshot(), seeded);
  } finally {
    db.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    context.mock.restoreAll();
    syncBuiltinESMExports();
    await rm(root, { recursive: true, force: true });
  }
});
