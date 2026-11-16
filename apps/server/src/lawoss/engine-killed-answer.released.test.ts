import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCode } from "@opencode/client";
import { listEngineMessages } from "../engine-client.js";
import { fixtureModel } from "./test-support/scripted-engine.js";

/**
 * #473: what the released engine keeps of an answer cut off by killing its process, which the chat relies on to mark it
 * (`apps/app/src/lawoss/chat/interrupted-run.tsx`). The streamed text is not saved until the step ends, so the answer
 * stays empty, without `time.completed`, `finish` or `error`, no idle marker follows and the chat is not active. Nothing
 * in the engine says the answer was interrupted; LAWOSS marks it from the restart time (`engineRestartedAt`).
 * Synthetic data only; HOME/XDG and the engine database are temporary.
 */
const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
async function start(home: string, modelUrl: string) {
  for (const folder of ["home", "config", "data", "cache", "state", "opencode-config", "project"]) await mkdir(join(home, folder), { recursive: true });
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }); const port = probe.port; probe.stop(true);
  const password = "synthetic";
  const child = Bun.spawn([binary!, "serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: home, stdout: "ignore", stderr: "ignore", env: {
    PATH: process.env.PATH ?? "", HOME: join(home, "home"), XDG_CONFIG_HOME: join(home, "config"), XDG_DATA_HOME: join(home, "data"), XDG_CACHE_HOME: join(home, "cache"), XDG_STATE_HOME: join(home, "state"),
    OPENCODE_CONFIG_DIR: join(home, "opencode-config"), OPENCODE_DB: join(home, "engine.db"), OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_CONFIG_PROJECT_DISABLE: "1", OPENCODE_CONFIG_CONTENT: JSON.stringify({ update: "disable", warming: false, ...fixtureModel(modelUrl), permissions: [{ action: "*", resource: "*", effect: "allow" }] }), OPENCODE_PASSWORD: password } });
  const url = `http://127.0.0.1:${port}`, authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  for (const deadline = Date.now() + 30_000; ; await Bun.sleep(100)) {
    if (Date.now() > deadline) throw new Error("engine did not start");
    if (await fetch(`${url}/api/info`, { headers: { authorization } }).then(r => r.ok, () => false)) break;
  }
  return { child, client: OpenCode.make({ baseUrl: url, headers: { authorization } }) };
}

test.skipIf(!binary)("#473: odpoveď prerušená zabitím enginu ostane po reštarte nedokončená, bez chyby a chat nie je aktívny", async () => {
  const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "f", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  let sent = 0;
  const model = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    return new Response(new ReadableStream({ async start(controller) {
      controller.enqueue(new TextEncoder().encode(chunk({ role: "assistant", content: "Prvý dôkazný prostriedok " }, null)));
      for (let i = 0; i < 100; i++) { await Bun.sleep(100); try { controller.enqueue(new TextEncoder().encode(chunk({ content: `veta${i} ` }, null))); sent++; } catch { return; } }
      controller.enqueue(new TextEncoder().encode(chunk({}, "stop") + "data: [DONE]\n\n")); controller.close();
    } }), { headers: { "content-type": "text/event-stream" } });
  } });
  const home = await mkdtemp(join(tmpdir(), "lawoss-killed-answer-"));
  const modelUrl = `http://127.0.0.1:${model.port}/v1`;
  const engines: Array<Awaited<ReturnType<typeof start>>> = [];
  try {
    const first = await start(home, modelUrl); engines.push(first);
    const session = await first.client.session.create({ location: { directory: join(home, "project") }, model: { providerID: "fixture", id: "fixture" } });
    await first.client.session.prompt({ sessionID: session.id, text: "Vymenuj dôkazné prostriedky." });
    while (sent < 20) await Bun.sleep(50);
    expect(Object.keys(await first.client.session.active())).toEqual([session.id]);
    first.child.kill(9); await first.child.exited;

    const second = await start(home, modelUrl); engines.push(second);
    const messages = await listEngineMessages(second.client, session.id);
    expect(messages.map(message => message.type)).toEqual(["user", "assistant"]);
    const answer = messages[1];
    if (answer?.type !== "assistant") throw new Error("missing assistant");
    expect(answer.time.completed).toBeUndefined();
    expect(answer.finish).toBeUndefined();
    expect(answer.error).toBeUndefined();
    expect(answer.content).toEqual([{ type: "text", text: "" }]);
    expect(await second.client.session.active()).toEqual({});
  } finally {
    for (const engine of engines) { engine.child.kill(9); await engine.child.exited; }
    model.stop(true);
    await rm(home, { recursive: true, force: true });
  }
}, 90_000);
