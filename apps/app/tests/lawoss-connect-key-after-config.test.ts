import { expect, test } from "bun:test";
import { OpenCode } from "@opencode/client";
import { connectKeyAfterConfig, isIntegrationNotFound } from "../src/lawoss/domains/settings/connect-key-after-config";

// Engine v2 preberá novú konfiguráciu poskytovateľa s oneskorením; kľúč nového vlastného poskytovateľa
// môže prvý raz dostať IntegrationNotFoundError (404). Uloženie ho zopakuje, iné chyby nie.

const clock = () => {
  let time = 0;
  return { now: () => time, sleep: async (ms: number) => { time += ms; } };
};

test("skutočná odpoveď enginu 404 IntegrationNotFoundError sa rozpozná cez @opencode/client", async () => {
  let attempts = 0;
  const server = Bun.serve({ port: 0, fetch: () => {
    attempts += 1;
    return attempts < 3
      ? Response.json({ _tag: "IntegrationNotFoundError", integrationID: "vlastny", message: "Integration not found" }, { status: 404 })
      : new Response(null, { status: 204 });
  } });
  try {
    const client = OpenCode.make({ baseUrl: server.url.toString().replace(/\/$/, "") });
    const connect = () => client.integration.connect.key({ integrationID: "vlastny", key: "synthetic-local-only", location: { directory: "/preview" } });
    const first = await connect().then(() => null, (error: unknown) => error);
    expect(isIntegrationNotFound(first)).toBe(true);
    let refreshes = 0;
    await connectKeyAfterConfig(async () => { refreshes += 1; }, connect, { ...clock(), intervalMs: 1 });
    expect(attempts).toBe(3);
    expect(refreshes).toBe(2);
  } finally {
    server.stop(true);
  }
});

test("po limite sa pôvodná chyba vráti, iná chyba sa neopakuje", async () => {
  const missing = Object.assign(new Error("Integration not found"), { _tag: "IntegrationNotFoundError" });
  let calls = 0;
  const timer = clock();
  await expect(connectKeyAfterConfig(async () => {}, async () => { calls += 1; throw missing; }, { ...timer, deadlineMs: 1_000, intervalMs: 200 })).rejects.toBe(missing);
  expect(calls).toBe(6);

  const unauthorized = Object.assign(new Error("Unauthorized"), { _tag: "UnauthorizedError" });
  calls = 0;
  await expect(connectKeyAfterConfig(async () => {}, async () => { calls += 1; throw unauthorized; }, clock())).rejects.toBe(unauthorized);
  expect(calls).toBe(1);
});

test("úspech na prvý pokus: jedna obnova katalógu a jedno uloženie ako v upstreame", async () => {
  const order: string[] = [];
  await connectKeyAfterConfig(async () => { order.push("model.list"); }, async () => { order.push("connect.key"); }, clock());
  expect(order).toEqual(["model.list", "connect.key"]);
});
