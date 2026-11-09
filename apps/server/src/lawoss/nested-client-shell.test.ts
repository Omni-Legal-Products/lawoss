// LAWOSS #264 (rozhodnutie MČ 31. 10. 2026): príkaz spravovaného shellu (`legalwork_shell` → `AgentSandboxService.run`)
// z chatu nadradeného klienta, ktorý spomína priečinok vnoreného iného klienta, dostane kartu s varovaním aj v YOLO.
// Vnorený priečinok bez karty pod kartou nadradeného je spis toho istého klienta: bez karty. Údaje sú syntetické.
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalService } from "../approvals.js";
import { AgentSandboxService } from "../agent-sandbox/service.js";
import { closeRuntimeOpencodeConfig, GLOBAL_TOOL_PERMISSIONS_ID, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ApprovalRequest, ServerConfig } from "../types.js";
import { nestedClientInCommand, separateNestedClientRoots } from "./linked-folders.js";
import { writeYoloMode } from "./yolo-mode.js";
import { nativeRow } from "./test-support/native-config.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

async function setup(cards: "both" | "none" | "parent") {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-nested-shell-")));
  const parent = join(root, "Klienti", "Tatran"), nested = join(parent, "Dcéra s.r.o.");
  await mkdir(join(nested, "Zmluvy"), { recursive: true });
  await writeFile(join(nested, "Zmluvy", "zmluva.txt"), "syntetický obsah");
  if (cards !== "none") await writeFile(join(parent, "client.md"), "# SYN Tatran\n");
  if (cards === "both") await writeFile(join(nested, "client.md"), "# SYN Dcéra\n");
  const saved = { LEGALWORK_RUNTIME_DB: process.env.LEGALWORK_RUNTIME_DB, XDG_DATA_HOME: process.env.XDG_DATA_HOME };
  process.env.LEGALWORK_RUNTIME_DB = join(root, "private", "runtime.sqlite");
  process.env.XDG_DATA_HOME = join(root, "data");
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture-host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: [{ id: "ws_p", name: "Tatran", path: parent, preset: "starter", workspaceType: "local" }, { id: "ws_n", name: "Dcéra", path: nested, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [parent, nested], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false, agentSandboxEnabled: true,
  };
  cleanups.push(async () => {
    await closeRuntimeOpencodeConfig(config);
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    Bun.gc(true);
    await rm(root, { recursive: true, force: true });
  });
  return { config, parent, nested };
}

test("nestedClientInCommand: absolútna aj relatívna cesta a pracovný priečinok; spis a vlastné priečinky nie", async () => {
  const { config, parent, nested } = await setup("both");
  const [p, n] = config.workspaces;
  expect(await separateNestedClientRoots(config, p!)).toEqual([nested]);
  expect(await separateNestedClientRoots(config, n!)).toEqual([parent]);
  expect(await nestedClientInCommand(config, p!, { command: `cat "${join(nested, "Zmluvy", "zmluva.txt")}"` }, parent)).toBe(nested);
  expect(await nestedClientInCommand(config, p!, { command: `ls "Dcéra s.r.o./Zmluvy"` }, parent)).toBe(nested);
  expect(await nestedClientInCommand(config, p!, { command: "ls", workdir: join(nested, "Zmluvy") }, join(nested, "Zmluvy"))).toBe(nested);
  expect(await nestedClientInCommand(config, p!, { command: `ls "/workspace/Dcéra s.r.o."` }, parent, "/workspace")).toBe(nested);
  expect(await nestedClientInCommand(config, p!, { command: "ls Spisy" }, parent)).toBeNull();
  const same = await setup("parent");
  expect(await nestedClientInCommand(same.config, same.config.workspaces[0]!, { command: `ls "Dcéra s.r.o."` }, same.parent)).toBeNull();
  const none = await setup("none");
  expect(await nestedClientInCommand(none.config, none.config.workspaces[0]!, { command: `ls "Dcéra s.r.o."` }, none.parent)).toBe(none.nested);
});

test("príkaz na tomto počítači do priečinka vnoreného iného klienta: karta s varovaním aj v YOLO, nezapamätá sa; vlastný príkaz v YOLO bez karty", async () => {
  const { config, parent, nested } = await setup("both");
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, () => nativeRow({ permission: { edit: "ask", bash: "ask" } }));
  await writeYoloMode(config, true);
  const asked: ApprovalRequest[] = [];
  const approvals: ApprovalService = new ApprovalService(config.approval, undefined, () => queueMicrotask(() => {
    for (const request of approvals.list()) { asked.push(request); approvals.respond(request.id, "deny"); }
  }));
  const service = new AgentSandboxService(config, approvals, { status: async () => ({ available: true }), prepare: async () => "fixture",
    run: async () => { throw new Error("The protected environment is off in this test."); } });
  cleanups.push(() => service.stop());
  const run = (command: string) => service.run(config.workspaces[0]!, { command, sessionID: "ses_1", write: false, timeoutMs: 10000 }, { type: "host" }, AbortSignal.timeout(15000));

  await expect(run(`cat "Dcéra s.r.o./Zmluvy/zmluva.txt" > kopia.txt`)).rejects.toMatchObject({ code: "sandbox_permission_declined" });
  expect(asked.map((request) => ({ action: request.action, otherClientFolder: request.otherClientFolder, canRemember: request.canRemember })))
    .toEqual([{ action: "sandbox.external_directory", otherClientFolder: nested, canRemember: false }]);
  await expect(readFile(join(parent, "kopia.txt"), "utf8")).rejects.toThrow();
  // Vlastný príkaz nadradeného klienta v YOLO: bez karty.
  asked.length = 0;
  expect(await run("echo syntetický > poznamka.txt")).toMatchObject({ sandbox: "host", exitCode: 0 });
  expect(asked).toEqual([]);
});
