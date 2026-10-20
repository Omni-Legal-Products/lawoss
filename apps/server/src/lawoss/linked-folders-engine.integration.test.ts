// LAWOSS: pripojené priečinky klienta v skutočnom engine (voliteľné, LEGALWORK_TEST_OPENCODE_BIN = pribalený 1.18.29).
// Spoločný súbor enginu priečinky klientov nemá (engine sa pýta); plugin `lawoss-linked-folders` podľa mapy od
// servera odpovie len v chatoch toho klienta. Dvaja klienti A a B v jednom engine, chat v koreni aj v prípade.
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { LINKED_FOLDERS_MAP_FILE, type LinkedFoldersMap } from "./linked-folders-rules.js";

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;

test.skipIf(!binary)("klient A číta svoje pripojené priečinky a koreň aj z prípadu; klient B ich nevidí, svoje áno; zmena platí bez reštartu", async () => {
  if (!binary) return;
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-linked-engine-")));
  const clientA = join(root, "prax", "Klienti", "Tatran");
  const matterA = join(clientA, "Spisy", "Úhrada");
  const clientB = join(root, "prax", "Klienti", "Hron");
  const linkedA = join(root, "Zdieľané", "Vzory zmlúv");
  const linkedA2 = join(root, "Zdieľané", "Judikatúra");
  const linkedB = join(root, "Hron podklady");
  for (const folder of [matterA, clientB, join(linkedA, "Rok 2026"), linkedA2, linkedB]) await mkdir(folder, { recursive: true });
  const files = {
    linkedA: join(linkedA, "Rok 2026", "vzor.md"), linkedA2: join(linkedA2, "rozsudok.md"), linkedB: join(linkedB, "hron.md"), clientA: join(clientA, "Klient.md"),
  };
  for (const [name, path] of Object.entries(files)) await writeFile(path, `Obsah ${name}`);

  const engineDir = join(root, "runtime");
  await mkdir(engineDir);
  const writeMap = (aFolders: string[]) => writeFile(join(engineDir, LINKED_FOLDERS_MAP_FILE), JSON.stringify({
    version: 1, officeRoot: join(root, "prax"), firmManaged: false,
    clients: [{ root: clientA, folders: aFolders }, { root: clientB, folders: [linkedB] }],
  } satisfies LinkedFoldersMap));
  await writeMap([linkedA]);

  let target = files.linkedA;
  const model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const input = z.object({ messages: z.array(z.object({ role: z.string() })) }).parse(await request.json());
    const step = input.messages.filter((message) => message.role === "tool").length;
    const delta = step === 0
      ? { tool_calls: [{ index: 0, id: "read_0", type: "function", function: { name: "read", arguments: JSON.stringify({ filePath: target }) } }] }
      : { content: "Hotovo." };
    const chunk = (body: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: body, finish_reason: finish }] })}\n\n`;
    return new Response(chunk({ role: "assistant", ...delta }, null) + chunk({}, step === 0 ? "tool_calls" : "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, "..", "opencode-plugins", "lawoss-linked-folders.ts")], outdir: join(root, "plugin"), target: "node", format: "esm" });
  expect(build.success).toBe(true);
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = reservation.port;
  reservation.stop(true);
  const engineConfig = join(engineDir, "runtime-opencode-config.json");
  // Ako spoločný súbor po tejto zmene: žiadne priečinky klientov, priečinky mimo chatu sa pýtajú.
  await writeFile(engineConfig, JSON.stringify({
    enabled_providers: ["fixture"], model: "fixture/fixture", small_model: "fixture/fixture", share: "disabled", autoupdate: false, lsp: false, formatter: false,
    provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "Fixture", options: { baseURL: model.url.origin + "/v1", apiKey: "fixture" }, models: { fixture: { name: "Fixture", limit: { context: 100000, output: 4000 } } } } },
    plugin: [pathToFileURL(build.outputs[0]!.path).href],
    permission: { "*": "allow", external_directory: { "*": "ask" } },
  }));
  const engine = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: clientA, env: {
    ...process.env, XDG_CONFIG_HOME: join(root, "engine-config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
    OPENCODE_TEST_HOME: root, OPENCODE_CONFIG: engineConfig, OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
  }, stdout: "ignore", stderr: "pipe" });
  const logs = new Response(engine.stderr).text();
  const base = `http://127.0.0.1:${port}`;
  const json = { "content-type": "application/json" };
  const at = (directory: string, path: string) => `${base}${path}?directory=${encodeURIComponent(directory)}`;
  const approvals = async (directory: string) => z.array(z.object({ id: z.string(), permission: z.string() })).parse(await (await fetch(at(directory, "/permission"))).json());

  /** Chat v `directory` prečíta `file`: „read“ = prečítal bez otázky, „asked“ = otázka ostala používateľovi (zamietne sa). */
  const attempt = async (directory: string, file: string): Promise<"read" | "asked"> => {
    target = file;
    const session = z.object({ id: z.string() }).parse(await (await fetch(at(directory, "/session"), { method: "POST", headers: json, body: "{}" })).json());
    const pending = fetch(at(directory, `/session/${session.id}/message`), { method: "POST", headers: json,
      body: JSON.stringify({ agent: "build", model: { providerID: "fixture", modelID: "fixture" }, parts: [{ type: "text", text: "Prečítaj súbor." }] }), signal: AbortSignal.timeout(60000) });
    const settled = pending.then(async (response) => { await response.text(); return "done" as const; });
    // Plugin odpovedá hneď; otázka, ktorá po 3 s stále visí, je otázka pre používateľa.
    await Promise.race([settled, Bun.sleep(3000)]);
    const open = await approvals(directory);
    if (open.length) {
      expect(open.map((approval) => approval.permission)).toEqual(["external_directory"]);
      for (const approval of open) await fetch(at(directory, `/permission/${approval.id}/reply`), { method: "POST", headers: json, body: JSON.stringify({ reply: "reject" }) });
      await settled;
      return "asked";
    }
    await settled;
    const parts = z.array(z.object({ parts: z.array(z.object({ tool: z.string().optional(), state: z.object({ status: z.string(), output: z.string().optional() }).optional() })) }))
      .parse(await (await fetch(at(directory, `/session/${session.id}/message`))).json()).flatMap((message) => message.parts).filter((part) => part.tool === "read");
    expect(parts.map((part) => part.state?.status)).toEqual(["completed"]);
    expect(parts[0]?.state?.output).toContain("Obsah ");
    return "read";
  };

  try {
    let ready = false;
    for (let i = 0; i < 200 && !ready && engine.exitCode === null; i++) {
      try { ready = (await fetch(base + "/global/health", { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Engine štartuje. */ }
      if (!ready) await Bun.sleep(100);
    }
    if (!ready) throw new Error("Engine did not start: " + (engine.exitCode !== null ? await logs : "timed out"));

    // Klient A (aj keď engine štartoval v A): koreň aj prípad čítajú pripojený priečinok; prípad aj koreň klienta.
    expect(await attempt(clientA, files.linkedA)).toBe("read");
    expect(await attempt(matterA, files.linkedA)).toBe("read");
    expect(await attempt(matterA, files.clientA)).toBe("read");
    // Klient B nevidí priečinky A, svoje áno.
    expect(await attempt(clientB, files.linkedA)).toBe("asked");
    expect(await attempt(clientB, files.linkedB)).toBe("read");
    // A nevidí B a nepripojený priečinok.
    expect(await attempt(clientA, files.linkedB)).toBe("asked");
    expect(await attempt(clientA, files.linkedA2)).toBe("asked");
    // Server pripojí ďalší priečinok: platí hneď, bez reštartu enginu; odpojenie tiež.
    await writeMap([linkedA, linkedA2]);
    expect(await attempt(matterA, files.linkedA2)).toBe("read");
    await writeMap([]);
    expect(await attempt(clientA, files.linkedA)).toBe("asked");
  } finally {
    engine.kill("SIGKILL");
    await engine.exited;
    model.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 240000);
