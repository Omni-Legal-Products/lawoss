import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProtectedSessionStore } from "./persisted-state.js";

test("private captured history retains exact actual data and refuses a changed SQLite checkpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "protected-session-store-"));
  try {
    const database = new Database(join(root, "engine.sqlite")); database.exec("CREATE TABLE session(id TEXT); INSERT INTO session VALUES ('ses_actual_capture')"); database.close();
    const checkpoint = await readFile(join(root, "engine.sqlite"));
    const store = new ProtectedSessionStore(join(root, "private"));
    const captured = { version: 1 as const, workspaceId: "project", sessionId: "ses_actual_capture", operationId: "e684de2b-2e79-4615-8b92-8df54f586821", input: { workspaceId: "project", caseDirectory: "", providerId: "selected", modelId: "selected", sources: [{ id: "2e83fca8-8e9c-45ad-8d8e-9ec48aca67a7", hash: "a".repeat(64) }] }, rootIdentity: "root", sourceSetSha256: "b".repeat(64), hostDirectory: root, workspaceRoot: root, guestDirectory: "/tmp/home/protected-engine/workspace" as const, capturedAt: new Date().toISOString(), session: { id: "ses_actual_capture", directory: "/tmp/home/protected-engine/workspace", title: "Captured fixture" }, messages: [{ info: { id: "msg_real", sessionID: "ses_actual_capture", role: "user" }, parts: [{ type: "text", text: "Synthetic stored history" }] }], children: [], todo: [], statuses: {} };
    const saved = await store.save(captured, checkpoint);
    expect((await store.load())[0].messages).toEqual(captured.messages);
    expect((await store.load())[0].sessionId).toBe("ses_actual_capture");
    await writeFile(saved.checkpoint.path, "changed checkpoint");
    await expect(store.load()).rejects.toMatchObject({ code: "protected_history_invalid" });
    await expect(store.save(captured, Buffer.from("not a database"))).rejects.toMatchObject({ code: "protected_history_invalid" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
