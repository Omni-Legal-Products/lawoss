import { afterEach, expect, test } from "bun:test";
import { access, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "../types.js";
import { ensureWikiAgentToken, issueWikiAgentTicket, redeemWikiAgentTicket, retainWikiAgentRuntime } from "../wiki/agent-access.js";
import { settleEngineAgentTicket } from "./engine-agent-ticket.js";

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });

async function fixture(pathStatus: number, ...laterStatuses: number[]) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-engine-settle-")));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "client", hostToken: "host",
    configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [],
    authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  cleanup.push(retainWikiAgentRuntime(config));
  const seen: Array<{ method: string; path: string; directory: string | null; authorization: string | null }> = [];
  const statuses = [pathStatus, ...laterStatuses];
  const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url);
    seen.push({ method: request.method, path: url.pathname, directory: url.searchParams.get("directory"), authorization: request.headers.get("authorization") });
    return Response.json({}, { status: url.pathname === "/path" ? statuses.shift() ?? pathStatus : 200 });
  } });
  cleanup.push(() => engine.stop(true));
  return { config, seen, directory: join(root, "probe"), engine: { url: engine.url.origin, username: "synthetic-user", password: "synthetic-password" } };
}
const authorization = `Basic ${Buffer.from("synthetic-user:synthetic-password").toString("base64")}`;

test("after the engine answers from a scratch instance, the window closes and the instance is released", async () => {
  const { config, seen, directory, engine } = await fixture(200);
  const ticket = issueWikiAgentTicket(config);
  const secret = redeemWikiAgentTicket(config, ticket);
  await settleEngineAgentTicket(config, engine, directory);
  await access(directory);
  expect(seen).toEqual([
    { method: "GET", path: "/path", directory, authorization },
    { method: "POST", path: "/instance/dispose", directory, authorization },
  ]);
  expect(() => redeemWikiAgentTicket(config, ticket)).toThrow(expect.objectContaining({ status: 403 }));
  expect(await ensureWikiAgentToken(config)).toBe(secret);
});

test("if the plugins never redeemed the ticket by then, it is spent", async () => {
  const { config, directory, engine } = await fixture(200);
  const ticket = issueWikiAgentTicket(config);
  await settleEngineAgentTicket(config, engine, directory);
  expect(() => redeemWikiAgentTicket(config, ticket)).toThrow(expect.objectContaining({ status: 403 }));
});

test("a slow engine is asked again, and the window closes once it answers", async () => {
  const { config, seen, directory, engine } = await fixture(500, 200);
  const ticket = issueWikiAgentTicket(config);
  const secret = redeemWikiAgentTicket(config, ticket);
  await settleEngineAgentTicket(config, engine, directory);
  expect(seen.map(item => item.path)).toEqual(["/path", "/path", "/instance/dispose"]);
  expect(() => redeemWikiAgentTicket(config, ticket)).toThrow(expect.objectContaining({ status: 403 }));
  expect(await ensureWikiAgentToken(config)).toBe(secret);
});

test("an engine that never answers leaves the window open only until its ten-minute limit", async () => {
  const { config, seen, directory, engine } = await fixture(500);
  const ticket = issueWikiAgentTicket(config);
  await expect(settleEngineAgentTicket(config, engine, directory)).rejects.toThrow("HTTP 500");
  expect(seen.map(item => item.path)).toEqual(Array.from({ length: 6 }, () => "/path"));
  const secret = redeemWikiAgentTicket(config, ticket);
  expect(() => redeemWikiAgentTicket(config, ticket, "", Date.now() + 601_000)).toThrow(expect.objectContaining({ status: 403 }));
  expect(await ensureWikiAgentToken(config)).toBe(secret);
  expect(() => redeemWikiAgentTicket(config, ticket)).toThrow(expect.objectContaining({ status: 403 }));
  expect(await ensureWikiAgentToken(config)).not.toBe(secret);
});

test("stopping the server abandons the probe without closing the window", async () => {
  const { config, directory, engine } = await fixture(200);
  const ticket = issueWikiAgentTicket(config);
  const stop = new AbortController();
  stop.abort();
  await expect(settleEngineAgentTicket(config, engine, directory, stop.signal)).rejects.toThrow();
  expect(redeemWikiAgentTicket(config, ticket)).toBe(await ensureWikiAgentToken(config));
});
