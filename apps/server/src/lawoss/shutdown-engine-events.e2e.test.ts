// LAWOSS #561: a planned app quit stops the managed engine while the desktop still reads
// the native event stream. The quit must end that stream cleanly and log nothing.
import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startEmbeddedServer } from "../embedded.js";
import { verifiedTestEngine } from "../opencode-candidate.test-support.js";
import { removeSyntheticTestDir } from "./test-support/inspect-cleanup.js";

const cleanup: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()?.(); });

async function start() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-shutdown-events-")));
  cleanup.push(() => removeSyntheticTestDir(root));
  const environment = { LEGALWORK_DATA_DIR: process.env.LEGALWORK_DATA_DIR, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, OPENCODE_DB: process.env.OPENCODE_DB };
  process.env.LEGALWORK_DATA_DIR = join(root, "data");
  process.env.XDG_CONFIG_HOME = join(root, "xdg");
  delete process.env.OPENCODE_DB;
  cleanup.push(() => {
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const client = join(root, "Klient A");
  await mkdir(client);
  await mkdir(join(root, "engine"));
  const sdk = join(root, "sdk");
  await mkdir(sdk);
  await writeFile(join(sdk, "package.json"), JSON.stringify({ opencode: { version: "2.1.4", runtime: "released-cli", providedModules: ["@opencode/plugin", "effect"] } }));
  // The engine holds its event stream open until it exits, like the released engine.
  const engine = await verifiedTestEngine(join(root, "engine"), (version) => `#!${process.execPath}
import { Database } from "bun:sqlite";
const database = new Database(process.env.OPENCODE_DB, { create: true });
database.exec("PRAGMA user_version=1");
database.close();
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const password = process.argv.includes("--service") ? (await Bun.file(process.env.OPENCODE_CONFIG_DIR + "/service-legalwork.json").json()).password : process.env.OPENCODE_PASSWORD;
const server = Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 0, async fetch(request) {
  const url = new URL(request.url);
  if (request.headers.get("authorization") !== "Basic " + Buffer.from("opencode:" + password).toString("base64")) return new Response("Unauthorized", { status: 401 });
  if (url.pathname === "/api/info") return Response.json({ version: ${JSON.stringify(version)}, pid: process.pid });
  if (url.pathname === "/api/experimental/migration/v1") return Response.json({ status: "completed", progress: { completed: 0, total: 0 } });
  if (url.pathname === "/api/event") return new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('data: {"type":"server.connected","data":{}}\\n\\n'));
  } }), { headers: { "content-type": "text/event-stream" } });
  return Response.json({ data: [] });
} });
if (process.argv.includes("--stdio")) { console.log(JSON.stringify({ url: "http://127.0.0.1:" + server.port })); process.stdin.on("end", () => process.exit(0)); process.stdin.resume(); }
else console.log("server listening on http://127.0.0.1:" + server.port);
process.on("SIGTERM", () => process.exit(0));
`);
  const server = await startEmbeddedServer({
    host: "127.0.0.1", port: 0, configPath: join(root, "server.json"), workspaces: [client],
    token: "client-token", hostToken: "host-token", logRequests: false, wordAddin: false,
    manageOpencode: true, opencodeBin: engine.bin, opencodeCandidateBuild: engine.candidateBuild, opencodeSdkDirectory: sdk,
    opencodeDirectory: client,
  });
  cleanup.push(() => server.stop());
  return server;
}

function logged(method: "error" | "warn") {
  const lines: string[] = [];
  const spy = spyOn(console, method).mockImplementation((...args: unknown[]) => { lines.push(args.map(arg => arg instanceof Error ? `${arg.message} ${String(arg.cause)}` : String(arg)).join(" ")); });
  cleanup.push(() => spy.mockRestore());
  return lines;
}

test("riadne ukončenie ukončí natívny prúd udalostí čisto a nič nezapíše ako chybu (#561)", async () => {
  const server = await start();
  const workspace = server.config.workspaces[0]!.id;
  const response = await fetch(`${server.url}/workspace/${encodeURIComponent(workspace)}/opencode/event`, { headers: { authorization: "Bearer client-token" } });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toContain("server.connected");

  const errors = logged("error"), warnings = logged("warn");
  await server.stop();
  const rest = await reader.read().then(result => ({ done: result.done }), (error: unknown) => ({ error: String(error) }));

  expect(rest).toEqual({ done: true });
  expect(errors.filter(line => /Engine event transport ended|Unhandled error|Response stream error/.test(line))).toEqual([]);
  expect(warnings.filter(line => /image cleanup/i.test(line))).toEqual([]);
}, 20_000);
