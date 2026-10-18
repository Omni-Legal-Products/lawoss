import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serverSentEvents, type SyncPoke } from "@legalwork/types/sync-events";

import { writeEigenweltConnection } from "./eigenwelt-connection-store.js";
import { startSyncEvents } from "./eigenwelt-sync-events.js";
import type { ServerConfig } from "./types.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

describe("pokes from the firm", () => {
  test("server-sent events are read across chunks, line endings and comments", () => {
    const seen: string[] = [];
    const feed = serverSentEvents((data) => seen.push(data));
    feed("retry: 5000\n\n: ping\n\ndata: {\"pro");
    feed("jects\":true}\r\n\r\ndata: a\ndata: b\n\n");
    expect(seen).toEqual(['{"projects":true}', "a\nb"]);
  });

  test("a signed-in computer keeps the stream open, hands on each poke, and connects again when it ends", async () => {
    const dir = await mkdtemp(join(tmpdir(), "legalwork-pokes-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const config = { configPath: join(dir, "server.json"), workspaces: [] } as unknown as ServerConfig;
    await writeEigenweltConnection(config, {
      platformToken: "tok_anna",
      account: { userId: "user_anna", userName: "Anna", userEmail: "anna@kanzlei.test", orgId: "org_kanzlei", orgName: "Kanzlei" },
    });
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const pokes: SyncPoke[] = [];
    const stream = (text: string) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text));
          controller.close();
        },
      });
    const fakeFetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
        const body = requests.length === 1 ? 'retry: 5000\n\ndata: {"resync":true}\n\ndata: {"projects":true,"tasks":true}\n\n' : 'data: {"resync":true}\n\n';
        return new Response(stream(body), { headers: { "Content-Type": "text/event-stream" } });
      },
      { preconnect: fetch.preconnect },
    );
    const stop = startSyncEvents(config, { fetch: fakeFetch, onPoke: (poke) => pokes.push(poke) });
    cleanups.push(stop);
    for (let waited = 0; pokes.length < 3 && waited < 5_000; waited += 50) await Bun.sleep(50);
    expect(pokes).toEqual([{ resync: true }, { projects: true, tasks: true }, { resync: true }]);
    expect(requests[0]).toMatchObject({ authorization: "Bearer tok_anna" });
    expect(requests[0]?.url.endsWith("/api/sync/events")).toBe(true);
  });
});

test("stopping events waits for an accepted response and never delivers a late poke", async () => {
  const dir = await mkdtemp(join(tmpdir(), "legalwork-pokes-stop-")); cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const config = { configPath: join(dir, "server.json"), workspaces: [] } as unknown as ServerConfig;
  await writeEigenweltConnection(config, { platformToken: "synthetic", account: { userId: "user", orgId: "org", userName: "Fixture", userEmail: "fixture@example.test", orgName: "Fixture" } });
  let enter!: () => void, resume!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const barrier = new Promise<void>(resolve => { resume = resolve; });
  const pokes: SyncPoke[] = [];
  const localFetch = Object.assign(async () => { enter(); await barrier; return new Response('data: {"resync":true}\n\n'); }, { preconnect: fetch.preconnect });
  const stop = startSyncEvents(config, { fetch: localFetch, onPoke: poke => pokes.push(poke) }); await entered;
  let stopped = false; const closing = Promise.resolve(stop()).then(() => { stopped = true; });
  try { await new Promise(resolve => setTimeout(resolve, 10)); expect(stopped).toBe(false); }
  finally { resume(); await closing; }
  expect(pokes).toEqual([]);
});
