// LAWOSS: pripojené priečinky klienta v skutočnom engine (voliteľné, LEGALWORK_TEST_OPENCODE_BIN).
// Chat veci beží v podpriečinku klienta (`?directory=<klient>/Spisy/<vec>`), engine číta oprávnenia z jedného
// konfiguračného súboru. Overí, že `external_directory: {"<priečinok>/*": "allow"}` pustí čítanie súboru
// vo vnorenom podpriečinku bez otázky a iný priečinok mimo chatu sa stále pýta.
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;

test.skipIf(!binary)("chat veci číta pripojený priečinok bez otázky; nepripojený priečinok sa pýta", async () => {
  if (!binary) return;
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-linked-engine-")));
  const client = join(root, "prax", "Klienti", "Tatran");
  const matter = join(client, "Spisy", "Uhrada");
  const linked = join(root, "Zdieľané", "Vzory zmlúv");
  const unrelated = join(root, "Iný klient");
  for (const folder of [matter, join(linked, "Rok 2026"), unrelated]) await mkdir(folder, { recursive: true });
  const linkedFile = join(linked, "Rok 2026", "vzor.md");
  const unrelatedFile = join(unrelated, "dôverné.md");
  await writeFile(linkedFile, "Vzor zmluvy o dielo");
  await writeFile(unrelatedFile, "Dôverné údaje iného klienta");

  let target = linkedFile;
  const model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const input = z.object({ messages: z.array(z.object({ role: z.string() })) }).parse(await request.json());
    const step = input.messages.filter((message) => message.role === "tool").length;
    const delta = step === 0
      ? { tool_calls: [{ index: 0, id: "read_0", type: "function", function: { name: "read", arguments: JSON.stringify({ filePath: target }) } }] }
      : { content: "Prečítané." };
    const chunk = (body: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: body, finish_reason: finish }] })}\n\n`;
    return new Response(chunk({ role: "assistant", ...delta }, null) + chunk({}, step === 0 ? "tool_calls" : "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = reservation.port;
  reservation.stop(true);
  const engineConfig = join(root, "engine.json");
  // Ako súbor, ktorý server zostaví pre klienta: pripojený priečinok „<priečinok>/*: allow“, inak engine pýta.
  await writeFile(engineConfig, JSON.stringify({
    enabled_providers: ["fixture"], model: "fixture/fixture", small_model: "fixture/fixture", share: "disabled", autoupdate: false, lsp: false, formatter: false,
    provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "Fixture", options: { baseURL: model.url.origin + "/v1", apiKey: "fixture" }, models: { fixture: { name: "Fixture", limit: { context: 100000, output: 4000 } } } } },
    permission: { "*": "allow", external_directory: { "*": "ask", [`${linked}/*`]: "allow" } },
  }));
  const engine = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: client, env: {
    ...process.env, XDG_CONFIG_HOME: join(root, "engine-config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
    OPENCODE_TEST_HOME: root, OPENCODE_CONFIG: engineConfig, OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
  }, stdout: "ignore", stderr: "pipe" });
  const logs = new Response(engine.stderr).text();
  const base = `http://127.0.0.1:${port}`;
  const scoped = (path: string) => `${base}${path}${path.includes("?") ? "&" : "?"}directory=${encodeURIComponent(matter)}`;
  const json = { "content-type": "application/json" };
  const newChat = async () => z.object({ id: z.string(), directory: z.string() }).parse(await (await fetch(scoped("/session"), { method: "POST", headers: json, body: "{}", signal: AbortSignal.timeout(30000) })).json());
  const prompt = (id: string) => fetch(scoped(`/session/${id}/message`), { method: "POST", headers: json,
    body: JSON.stringify({ agent: "build", model: { providerID: "fixture", modelID: "fixture" }, parts: [{ type: "text", text: "Prečítaj súbor." }] }), signal: AbortSignal.timeout(60000) });
  const readParts = async (id: string) => z.array(z.object({ parts: z.array(z.object({ tool: z.string().optional(), state: z.object({ status: z.string(), output: z.string().optional() }).optional() })) }))
    .parse(await (await fetch(scoped(`/session/${id}/message`))).json()).flatMap((message) => message.parts).filter((part) => part.tool === "read");
  try {
    let ready = false;
    for (let i = 0; i < 200 && !ready && engine.exitCode === null; i++) {
      try { ready = (await fetch(base + "/global/health", { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Engine štartuje. */ }
      if (!ready) await Bun.sleep(100);
    }
    if (!ready) throw new Error("Engine did not start: " + (engine.exitCode !== null ? await logs : "timed out"));

    const chat = await newChat();
    expect(chat.directory).toBe(matter);
    const response = await prompt(chat.id);
    expect(response.status, await response.text()).toBe(200);
    const reads = await readParts(chat.id);
    expect(reads.map((part) => part.state?.status)).toEqual(["completed"]);
    expect(reads[0]?.state?.output).toContain("Vzor zmluvy o dielo");
    expect(await (await fetch(scoped("/permission"))).json()).toEqual([]);

    target = unrelatedFile;
    const other = await newChat();
    const pending = prompt(other.id);
    let approvals: Array<{ id: string; permission: string }> = [];
    for (let i = 0; i < 200 && approvals.length === 0; i++) {
      approvals = z.array(z.object({ id: z.string(), permission: z.string() })).parse(await (await fetch(scoped("/permission"))).json());
      if (approvals.length === 0) await Bun.sleep(50);
    }
    expect(approvals.map((approval) => approval.permission)).toEqual(["external_directory"]);
    await fetch(scoped(`/permission/${approvals[0]!.id}/reply`), { method: "POST", headers: json, body: JSON.stringify({ reply: "reject" }) });
    await (await pending).text();
  } finally {
    engine.kill("SIGKILL");
    await engine.exited;
    model.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 120000);
