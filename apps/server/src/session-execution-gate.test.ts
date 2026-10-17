import { test, expect } from "bun:test";
import { beginSessionDeletion, withSessionExecution } from "./session-execution-gate.js";
import type { ServerConfig } from "./types.js";
const config: ServerConfig = { host: "localhost", port: 0, token: "test", hostToken: "host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false, startedAt: 0, tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };

test("pending delivery is reserved before preparation and releases after failure", async () => {
  await expect(withSessionExecution(config, "pending", async () => {
    expect(() => beginSessionDeletion(config, "pending")).toThrow();
    throw new Error("Preparation failed");
  })).rejects.toThrow("Preparation failed");
  beginSessionDeletion(config, "pending")();
});

test("queued delivery waits for the delete check without being lost or failing the queue", async () => {
  const release = beginSessionDeletion(config, "queued");
  let sent = false;
  const pending = withSessionExecution(config, "queued", async () => { sent = true; }, true);
  expect(sent).toBe(false);
  await expect(withSessionExecution(config, "queued", async () => {})).rejects.toMatchObject({ code: "session_busy" });
  release();
  await pending;
  expect(sent).toBe(true);
  beginSessionDeletion(config, "queued")();
});
