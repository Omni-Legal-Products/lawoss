// LAWOSS: lawoss_files na serveri – plán pre jednu kartu, vykonanie len schváleného plánu, pravdivý výsledok.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { ensureWikiAgentToken, grantWikiAgentSession } from "../wiki/agent-access.js";
import { applyFileOperations, planFileOperations, publicPlan } from "./file-operations.js";

const roots: string[] = [];
const stops: Array<() => void | Promise<void>> = [];
const prior = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE, db: process.env.LEGALWORK_RUNTIME_DB };

beforeEach(async () => {
  const env = await realpath(await mkdtemp(join(tmpdir(), "lawoss-files-env-")));
  roots.push(env);
  process.env.LEGALWORK_DATA_DIR = join(env, "data");
  process.env.LEGALWORK_TOKEN_STORE = join(env, "tokens.json");
  process.env.LEGALWORK_RUNTIME_DB = join(env, "runtime.sqlite");
});
afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  Bun.gc(true);
  while (roots.length) await rm(roots.pop() ?? "", { recursive: true, force: true });
  for (const [key, value] of [["LEGALWORK_DATA_DIR", prior.data], ["LEGALWORK_TOKEN_STORE", prior.tokens], ["LEGALWORK_RUNTIME_DB", prior.db]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

/** Two synthetic clients and a folder linked to the first one. */
async function office() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-files-")));
  roots.push(root);
  const client = join(root, "Klienti", "C001-Synteticka"), other = join(root, "Klienti", "C017-Ina"), linked = join(root, "Zdielane", "pripojeny-A");
  for (const folder of [join(client, "Pripady", "M001"), other, linked]) await mkdir(folder, { recursive: true });
  await writeFile(join(client, "poznamky.txt"), "SYN poznamky");
  await writeFile(join(client, "Pripady", "M001", "zmluva.txt"), "SYN zmluva");
  await writeFile(join(linked, "podklad.pdf"), "SYN pdf");
  await writeFile(join(other, "tajne.txt"), "SYN iny klient");
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, configPath: join(root, "server.json"), token: "owt_files_client", hostToken: "owt_files_host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"],
    workspaces: [
      { id: "ws_c001", name: "C001", path: client, preset: "starter", workspaceType: "local" },
      { id: "ws_c017", name: "C017", path: other, preset: "starter", workspaceType: "local" },
    ],
    authorizedRoots: [client, other], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  stops.push(() => closeRuntimeOpencodeConfig(config));
  await writeRuntimeOpencodeConfig(config, "ws_c001", () => ({ permission: { external_directory: { [`${linked}/*`]: "allow" } } }));
  return { root, config, client, other, linked, workspace: config.workspaces[0] };
}

test("a rename is planned with readable paths and runs only as approved, reporting the disk", async () => {
  const { config, client, workspace } = await office();
  const operations = [{ operation: "move", from: join(client, "poznamky.txt"), to: join(client, "SYN-overenie.txt") }];
  const plan = publicPlan(await planFileOperations(config, workspace, operations));
  expect(plan).toEqual([{ operation: "move", kind: "file", from: "poznamky.txt", to: "SYN-overenie.txt" }]);
  // No canonical path of any folder reaches the card or the model.
  expect(JSON.stringify(plan)).not.toContain(client);
  const result = await applyFileOperations(config, workspace, operations, plan, "ses_1");
  expect(result).toEqual({ complete: true, results: [{ ...plan[0], status: "done" }] });
  expect(await readFile(join(client, "SYN-overenie.txt"), "utf8")).toBe("SYN poznamky");
  expect(await readdir(client)).not.toContain("poznamky.txt");
});

test("nothing runs when the disk changed after the card, and nothing is ever overwritten", async () => {
  const { config, client, workspace } = await office();
  const operations = [{ operation: "move", from: join(client, "poznamky.txt"), to: join(client, "nove.txt") }];
  const plan = publicPlan(await planFileOperations(config, workspace, operations));
  await writeFile(join(client, "nove.txt"), "SYN medzitym");
  await expect(applyFileOperations(config, workspace, operations, plan)).rejects.toMatchObject({ code: "file_operation_target_exists" });
  // A different plan than the approved one is refused before anything runs.
  await expect(applyFileOperations(config, workspace, [{ operation: "delete", path: join(client, "nove.txt") }], plan)).rejects.toMatchObject({ code: "file_operation_changed" });
  expect(await readFile(join(client, "nove.txt"), "utf8")).toBe("SYN medzitym");
  expect(await readFile(join(client, "poznamky.txt"), "utf8")).toBe("SYN poznamky");
});

test("one card for a batch: a new folder, moves into it, a copy and a delete, checked in order", async () => {
  const { config, client, linked, workspace } = await office();
  const operations = [
    { operation: "create_folder", path: join(client, "Zmluvy") },
    { operation: "move", from: join(client, "Pripady", "M001", "zmluva.txt"), to: join(client, "Zmluvy", "01_Zmluva.txt") },
    { operation: "copy", from: join(linked, "podklad.pdf"), to: join(client, "Zmluvy", "podklad.pdf") },
    { operation: "delete", path: join(client, "Pripady", "M001") },
  ];
  const plan = publicPlan(await planFileOperations(config, workspace, operations));
  expect(plan).toEqual([
    { operation: "create_folder", kind: "folder", to: "Zmluvy" },
    { operation: "move", kind: "file", from: "Pripady/M001/zmluva.txt", to: "Zmluvy/01_Zmluva.txt" },
    // A linked folder shows by its name, not its full path.
    { operation: "copy", kind: "file", from: "pripojeny-A/podklad.pdf", to: "Zmluvy/podklad.pdf" },
    { operation: "delete", kind: "folder", from: "Pripady/M001", entries: 1 },
  ]);
  expect((await applyFileOperations(config, workspace, operations, plan)).complete).toBe(true);
  expect((await readdir(join(client, "Zmluvy"))).sort()).toEqual(["01_Zmluva.txt", "podklad.pdf"]);
  expect(await readdir(join(client, "Pripady"))).toEqual([]);
  expect(await readFile(join(linked, "podklad.pdf"), "utf8")).toBe("SYN pdf");
  // Two changes to the same target in one request: refused before the card.
  await expect(planFileOperations(config, workspace, [
    { operation: "copy", from: join(client, "poznamky.txt"), to: join(client, "a.txt") },
    { operation: "copy", from: join(client, "poznamky.txt"), to: join(client, "a.txt") },
  ])).rejects.toMatchObject({ code: "file_operation_target_exists" });
});

test("another client's folder, the client folder itself and app configuration are refused without naming anyone", async () => {
  const { config, client, other, workspace } = await office();
  const outside = await planFileOperations(config, workspace, [{ operation: "move", from: join(other, "tajne.txt"), to: join(client, "tajne.txt") }]).catch((error: unknown) => error);
  expect(outside).toMatchObject({ status: 403, code: "file_operation_outside_client" });
  expect(String(Reflect.get(Object(outside), "message"))).not.toContain("C017");
  await expect(planFileOperations(config, workspace, [{ operation: "copy", from: join(client, "poznamky.txt"), to: join(other, "x.txt") }]))
    .rejects.toMatchObject({ code: "file_operation_outside_client" });
  await expect(planFileOperations(config, workspace, [{ operation: "delete", path: client }])).rejects.toMatchObject({ status: 403 });
  await expect(planFileOperations(config, workspace, [{ operation: "create_folder", path: join(client, ".opencode", "x") }])).rejects.toMatchObject({ code: "file_operation_protected" });
  expect(await readFile(join(other, "tajne.txt"), "utf8")).toBe("SYN iny klient");
});

test("only the chat's own tool credential reaches the routes; the change is bound to that chat", async () => {
  const { config, client } = await office();
  const server = await startServer(config);
  stops.push(() => server.stop());
  await grantWikiAgentSession(config, { sessionId: "ses_1", directory: client, scope: "collaborator" });
  const agent = { "x-legalwork-wiki-agent-token": await ensureWikiAgentToken(config), "x-legalwork-wiki-agent-session": "ses_1",
    "x-legalwork-wiki-agent-directory": encodeURIComponent(client) };
  const post = (route: string, body: unknown, headers: Record<string, string>) => fetch(`http://127.0.0.1:${server.port}/workspace/ws_c001/lawoss/files/${route}`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
  const operations = [{ operation: "move", from: join(client, "poznamky.txt"), to: join(client, "x.txt") }];
  // A client token has its own file routes with their own approvals; it cannot skip a card here.
  const bearer = await post("plan", { operations }, { authorization: "Bearer owt_files_client" });
  expect(bearer.status).toBe(403);
  expect(await bearer.json()).toMatchObject({ code: "file_operation_agent_only" });
  const planned = await post("plan", { operations }, agent);
  expect(planned.status).toBe(200);
  const { operations: approved } = await planned.json();
  expect((await post("plan", { operations: [] }, agent)).status).toBe(400);
  // The apply names the chat that showed the card.
  expect((await post("apply", { operations, approved, sessionID: "ses_other" }, agent)).status).toBe(403);
  config.readOnly = true;
  expect((await post("apply", { operations, approved, sessionID: "ses_1" }, agent)).status).toBe(403);
  config.readOnly = false;
  expect(await readFile(join(client, "poznamky.txt"), "utf8")).toBe("SYN poznamky");
  const applied = await post("apply", { operations, approved, sessionID: "ses_1" }, agent);
  expect(await applied.json()).toMatchObject({ complete: true, results: [{ status: "done", to: "x.txt" }] });
  expect(await readFile(join(client, "x.txt"), "utf8")).toBe("SYN poznamky");
});
