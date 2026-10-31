// LAWOSS: lawoss_files na serveri – plán pre jednu kartu, vykonanie len schváleného plánu, pravdivý výsledok.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import { closeRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { ensureWikiAgentToken, grantWikiAgentSession } from "../wiki/agent-access.js";
import { auditLogPath } from "../audit.js";
import { fileOperationReport } from "../opencode-plugins/lawoss-file-operations-text.js";
import { applyFileOperations, confusableNames, executePlannedFileOperation, FOLDER_SURVEY_LIMIT, moveAcrossVolumes, LAWOSS_TRASH_FOLDER, linkedFolderLabels, planFileOperations, systemTrashReliable, visibleName, type PlannedFileOperation } from "./file-operations.js";

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
    // The app's own config folder is app data (linked-folders rules): keep it apart from the office.
    host: "127.0.0.1", port: 0, configPath: join(root, "private", "server.json"), token: "owt_files_client", hostToken: "owt_files_host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"],
    workspaces: [
      { id: "ws_c001", name: "C001", path: client, preset: "starter", workspaceType: "local" },
      { id: "ws_c017", name: "C017", path: other, preset: "starter", workspaceType: "local" },
    ],
    authorizedRoots: [client, other], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  stops.push(() => closeRuntimeOpencodeConfig(config));
  // No desktop host in these tests unless a test installs one: deleted items go to `.lawoss-kos/`.
  config.trashItem = null;
  await writeRuntimeOpencodeConfig(config, "ws_c001", () => ({ permission: { external_directory: { [`${linked}/*`]: "allow" } } }));
  return { root, config, client, other, linked, workspace: config.workspaces[0] };
}

/** APFS default: names differ only in case resolve to the same file. */
async function caseInsensitive(folder: string): Promise<boolean> {
  await writeFile(join(folder, "case-probe"), "");
  try { await access(join(folder, "CASE-PROBE")); return true; } catch { return false; } finally { await rm(join(folder, "case-probe"), { force: true }); }
}

test("a rename is planned with readable paths and runs only as approved, reporting the disk", async () => {
  const { config, client, workspace } = await office();
  const operations = [{ operation: "move", from: join(client, "poznamky.txt"), to: join(client, "SYN-overenie.txt") }];
  const plan = await planFileOperations(config, workspace, operations);
  expect(plan.operations).toEqual([{ operation: "move", kind: "file", from: "poznamky.txt", to: "SYN-overenie.txt" }]);
  expect(plan.revision).toMatch(/^[a-f0-9]{64}$/);
  // No canonical path of any folder reaches the card or the model.
  expect(JSON.stringify(plan)).not.toContain(client);
  const result = await applyFileOperations(config, workspace, operations, plan.operations, plan.revision, "ses_1");
  expect(result).toEqual({ complete: true, results: [{ ...plan.operations[0], status: "done" }] });
  expect(await readFile(join(client, "SYN-overenie.txt"), "utf8")).toBe("SYN poznamky");
  expect(await readdir(client)).not.toContain("poznamky.txt");
});

test("nothing runs when the disk changed after the card, and nothing is ever overwritten", async () => {
  const { config, client, workspace } = await office();
  const operations = [{ operation: "move", from: join(client, "poznamky.txt"), to: join(client, "nove.txt") }];
  const plan = await planFileOperations(config, workspace, operations);
  await writeFile(join(client, "nove.txt"), "SYN medzitym");
  await expect(applyFileOperations(config, workspace, operations, plan.operations, plan.revision)).rejects.toMatchObject({ code: "file_operation_target_exists" });
  // A different plan than the approved one is refused before anything runs.
  await expect(applyFileOperations(config, workspace, [{ operation: "delete", path: join(client, "nove.txt") }], plan.operations, plan.revision)).rejects.toMatchObject({ code: "file_operation_changed" });
  expect(await readFile(join(client, "nove.txt"), "utf8")).toBe("SYN medzitym");
  expect(await readFile(join(client, "poznamky.txt"), "utf8")).toBe("SYN poznamky");
});

test("the approval is bound to the file's content and a folder's contents, not just its name", async () => {
  const { config, client, workspace } = await office();
  const file = [{ operation: "delete", path: join(client, "poznamky.txt") }];
  const shown = await planFileOperations(config, workspace, file);
  await writeFile(join(client, "poznamky.txt"), "SYN prepisane po karte");
  await expect(applyFileOperations(config, workspace, file, shown.operations, shown.revision)).rejects.toMatchObject({ code: "file_operation_changed" });
  // Same bytes again, a different modification time: still not the version the lawyer saw.
  await writeFile(join(client, "poznamky.txt"), "SYN poznamky");
  await utimes(join(client, "poznamky.txt"), new Date(2020, 0, 1), new Date(2020, 0, 1));
  await expect(applyFileOperations(config, workspace, file, shown.operations, shown.revision)).rejects.toMatchObject({ code: "file_operation_changed" });
  // A file added deep inside a folder after the card.
  const folder = [{ operation: "delete", path: join(client, "Pripady") }];
  const folderPlan = await planFileOperations(config, workspace, folder);
  await writeFile(join(client, "Pripady", "M001", "novy.txt"), "SYN");
  await expect(applyFileOperations(config, workspace, folder, folderPlan.operations, folderPlan.revision)).rejects.toMatchObject({ code: "file_operation_changed" });
  // A forged or missing revision is refused even with the right visible plan.
  const fresh = await planFileOperations(config, workspace, folder);
  await expect(applyFileOperations(config, workspace, folder, fresh.operations, "0".repeat(64))).rejects.toMatchObject({ code: "file_operation_changed" });
  await expect(applyFileOperations(config, workspace, folder, fresh.operations, undefined)).rejects.toMatchObject({ code: "file_operation_changed" });
  expect(await readdir(join(client, "Pripady", "M001"))).toEqual(["novy.txt", "zmluva.txt"]);
});

test("one card for a batch: a new folder, moves into it, a copy and a recoverable delete, checked in order", async () => {
  const { config, client, linked, workspace } = await office();
  await mkdir(join(client, "Prazdny"));
  const operations = [
    { operation: "create_folder", path: join(client, "Zmluvy") },
    { operation: "move", from: join(client, "Pripady", "M001", "zmluva.txt"), to: join(client, "Zmluvy", "01_Zmluva.txt") },
    { operation: "copy", from: join(linked, "podklad.pdf"), to: join(client, "Zmluvy", "podklad.pdf") },
    { operation: "delete", path: join(client, "Pripady", "M001") },
    { operation: "delete", path: join(client, "Prazdny") },
  ];
  const plan = await planFileOperations(config, workspace, operations);
  expect(plan.operations).toEqual([
    { operation: "create_folder", kind: "folder", to: "Zmluvy" },
    { operation: "move", kind: "file", from: "Pripady/M001/zmluva.txt", to: "Zmluvy/01_Zmluva.txt" },
    // A linked folder shows by its name, not its full path.
    { operation: "copy", kind: "file", from: "pripojeny-A/podklad.pdf", to: "Zmluvy/podklad.pdf" },
    // Surveyed before the batch runs: the move out of it is part of the same approval.
    { operation: "delete", kind: "folder", from: "Pripady/M001", entries: 1 },
    // An empty folder is still a folder.
    { operation: "delete", kind: "folder", from: "Prazdny", entries: 0 },
  ]);
  const applied = await applyFileOperations(config, workspace, operations, plan.operations, plan.revision);
  expect(applied.complete).toBe(true);
  expect((await readdir(join(client, "Zmluvy"))).sort()).toEqual(["01_Zmluva.txt", "podklad.pdf"]);
  expect(await readdir(join(client, "Pripady"))).toEqual([]);
  expect(await readFile(join(linked, "podklad.pdf"), "utf8")).toBe("SYN pdf");
  // Without the desktop Trash the folder is kept, restorable, in the client's own Trash folder.
  const trash = applied.results.filter((item) => item.operation === "delete").map((item) => item.trash ?? "");
  expect(trash[0]).toMatch(new RegExp(`^${LAWOSS_TRASH_FOLDER}/[^/]+/Pripady/M001$`));
  expect(await readdir(join(client, trash[0]!))).toEqual([]);
  expect(await readdir(join(client, trash[1]!))).toEqual([]);
  // What the agent tells the lawyer names the real place: the client's own folder (P3 review of #227).
  expect(fileOperationReport(applied).find((line) => line.startsWith("Pripady/M001:"))).toContain(`in the recovery folder ${trash[0]} in the client's folder`);
  // Two changes to the same target in one request: refused before the card.
  await expect(planFileOperations(config, workspace, [
    { operation: "copy", from: join(client, "poznamky.txt"), to: join(client, "a.txt") },
    { operation: "copy", from: join(client, "poznamky.txt"), to: join(client, "a.txt") },
  ])).rejects.toMatchObject({ code: "file_operation_target_exists" });
});

test("delete uses the OS Trash through the desktop host, and falls back inside the same root when it fails", async () => {
  const { config, client, linked, workspace } = await office();
  const trashed: string[] = [];
  config.trashItem = async (path) => { trashed.push(path); await rm(path, { recursive: true }); };
  const operations = [{ operation: "delete", path: join(client, "poznamky.txt") }];
  const plan = await planFileOperations(config, workspace, operations);
  expect(await applyFileOperations(config, workspace, operations, plan.operations, plan.revision)).toEqual({ complete: true,
    results: [{ operation: "delete", kind: "file", from: "poznamky.txt", status: "done", trash: "system" }] });
  expect(trashed).toEqual([join(client, "poznamky.txt")]);
  // A network volume without a Trash: the linked folder keeps the item in its own `.lawoss-kos/`.
  config.trashItem = async () => { throw new Error("Trash unavailable on this volume"); };
  const linkedDelete = [{ operation: "delete", path: join(linked, "podklad.pdf") }];
  const linkedPlan = await planFileOperations(config, workspace, linkedDelete);
  const result = await applyFileOperations(config, workspace, linkedDelete, linkedPlan.operations, linkedPlan.revision);
  expect(result.results[0]?.trash).toMatch(new RegExp(`^pripojeny-A/${LAWOSS_TRASH_FOLDER}/[^/]+/podklad\\.pdf$`));
  // …and the agent says it is in the linked folder (a NAS), not in the client's folder (P3 review of #227).
  const [linkedLine] = fileOperationReport(result);
  expect(linkedLine).toContain(`in the recovery folder ${result.results[0]?.trash} in the linked folder pripojeny-A`);
  expect(linkedLine).not.toContain("client's folder");
  const [batch] = await readdir(join(linked, LAWOSS_TRASH_FOLDER));
  expect(await readFile(join(linked, LAWOSS_TRASH_FOLDER, batch!, "podklad.pdf"), "utf8")).toBe("SYN pdf");
  // The Trash folder itself is out of the tool's reach.
  await expect(planFileOperations(config, workspace, [{ operation: "delete", path: join(linked, LAWOSS_TRASH_FOLDER) }])).rejects.toMatchObject({ code: "file_operation_protected" });
  await expect(planFileOperations(config, workspace, [{ operation: "move", from: join(linked, ".LAWOSS-KOS", batch!, "podklad.pdf"), to: join(client, "x.pdf") }])).rejects.toMatchObject({ status: 403 });
});

test("a recovery folder in a linked folder keeps its label for a name with an escaped character (review of #227)", async () => {
  const { config, linked, workspace } = await office();
  config.trashItem = async () => { throw new Error("Trash unavailable on this volume"); };
  await writeFile(join(linked, "pod\u202eklad.pdf"), "SYN pdf");
  const operations = [{ operation: "delete", path: join(linked, "pod\u202eklad.pdf") }];
  const plan = await planFileOperations(config, workspace, operations);
  const result = await applyFileOperations(config, workspace, operations, plan.operations, plan.revision);
  expect(result.results[0]?.trash).toMatch(new RegExp(`^pripojeny-A/${LAWOSS_TRASH_FOLDER}/[^/]+/pod\\\\u202eklad\\.pdf$`));
});

test("another client's folder, the client folder itself, app and version-control data are refused in any letter case", async () => {
  const { config, client, other, workspace } = await office();
  await mkdir(join(client, ".git"));
  await writeFile(join(client, ".git", "HEAD"), "ref: refs/heads/dev");
  const outside = await planFileOperations(config, workspace, [{ operation: "move", from: join(other, "tajne.txt"), to: join(client, "tajne.txt") }]).catch((error: unknown) => error);
  expect(outside).toMatchObject({ status: 403, code: "file_operation_outside_client" });
  expect(String(Reflect.get(Object(outside), "message"))).not.toContain("C017");
  await expect(planFileOperations(config, workspace, [{ operation: "copy", from: join(client, "poznamky.txt"), to: join(other, "x.txt") }]))
    .rejects.toMatchObject({ code: "file_operation_outside_client" });
  await expect(planFileOperations(config, workspace, [{ operation: "delete", path: client }])).rejects.toMatchObject({ status: 403 });
  for (const name of [".git", ".GIT", ".Git", ".git.", ".opencode/x", ".OPENCODE/x"])
    await expect(planFileOperations(config, workspace, [{ operation: "delete", path: join(client, name) }])).rejects.toMatchObject({ status: 403 });
  await expect(planFileOperations(config, workspace, [{ operation: "create_folder", path: join(client, ".opencode", "x") }])).rejects.toMatchObject({ code: "file_operation_protected" });
  expect(await readFile(join(client, ".git", "HEAD"), "utf8")).toBe("ref: refs/heads/dev");
  expect(await readFile(join(other, "tajne.txt"), "utf8")).toBe("SYN iny klient");
});

test("a client registered inside this client's folder is out of reach, its folder and any folder holding it too (review #221)", async () => {
  const { config, client, workspace } = await office();
  const nested = join(client, "Klienti-vnorene", "C099-Vnoreny");
  await mkdir(nested, { recursive: true });
  await writeFile(join(nested, "zmluva.txt"), "SYN vnoreny klient");
  config.workspaces.push({ id: "ws_c099", name: "C099", path: nested, preset: "starter", workspaceType: "local" });
  for (const operations of [
    [{ operation: "copy", from: join(nested, "zmluva.txt"), to: join(client, "kopia.txt") }],
    [{ operation: "move", from: join(client, "poznamky.txt"), to: join(nested, "poznamky.txt") }],
    [{ operation: "delete", path: nested }],
    [{ operation: "delete", path: join(client, "Klienti-vnorene") }],
    [{ operation: "move", from: join(client, "Klienti-vnorene"), to: join(client, "Archiv") }],
    [{ operation: "create_folder", path: join(nested, "Novy") }],
  ]) {
    const refused = await planFileOperations(config, workspace, operations).catch((error: unknown) => error);
    expect(refused).toMatchObject({ status: 403, code: "file_operation_outside_client" });
    expect(String(Reflect.get(Object(refused), "message"))).not.toContain("C099");
  }
  if (await caseInsensitive(client))
    await expect(planFileOperations(config, workspace, [{ operation: "delete", path: join(client, "KLIENTI-VNORENE", "c099-vnoreny", "zmluva.txt") }]))
      .rejects.toMatchObject({ code: "file_operation_outside_client" });
  // The client's own files stay reachable.
  expect((await planFileOperations(config, workspace, [{ operation: "copy", from: join(client, "poznamky.txt"), to: join(client, "kopia.txt") }])).operations).toHaveLength(1);
  expect(await readFile(join(nested, "zmluva.txt"), "utf8")).toBe("SYN vnoreny klient");
});

test("an earlier step of the same request cannot turn a later target into a nested client's folder", async () => {
  const { config, client, workspace } = await office();
  const nested = join(client, "Klienti-vnorene", "C099-Vnoreny");
  await mkdir(nested, { recursive: true });
  await writeFile(join(nested, "zmluva.txt"), "SYN vnoreny klient");
  config.workspaces.push({ id: "ws_c099", name: "C099", path: nested, preset: "starter", workspaceType: "local" });
  await symlink(nested, join(client, "Odkaz"));
  await mkdir(join(client, "Obal"));
  await symlink(nested, join(client, "Obal", "Odkaz"));
  for (const operations of [
    [{ operation: "move", from: join(client, "Odkaz"), to: join(client, "Novy") },
      { operation: "copy", from: join(client, "poznamky.txt"), to: join(client, "Novy", "poznamky.txt") }],
    [{ operation: "move", from: join(client, "Obal"), to: join(client, "Presunuty") },
      { operation: "move", from: join(client, "poznamky.txt"), to: join(client, "Presunuty", "Odkaz", "poznamky.txt") }],
  ]) {
    const plan = await planFileOperations(config, workspace, operations);
    const result = await applyFileOperations(config, workspace, operations, plan.operations, plan.revision);
    expect(result.complete).toBe(false);
    expect(result.results[1]).toMatchObject({ status: "failed" });
    expect(await readdir(nested)).toEqual(["zmluva.txt"]);
  }
  expect(await readFile(join(client, "poznamky.txt"), "utf8")).toBeTruthy();
});

test("an earlier step cannot route a later target to another client or protected data either", async () => {
  const { config, client, other, workspace } = await office();
  await mkdir(join(client, ".git"));
  await mkdir(join(client, "Obal"));
  await symlink(other, join(client, "Obal", "Iny"));
  await mkdir(join(client, "Obal2"));
  await symlink(join(client, ".git"), join(client, "Obal2", "Git"));
  for (const [operations, guarded] of [
    [[{ operation: "move", from: join(client, "Obal"), to: join(client, "Presunuty") },
      { operation: "copy", from: join(client, "poznamky.txt"), to: join(client, "Presunuty", "Iny", "poznamky.txt") }], other],
    [[{ operation: "move", from: join(client, "Obal2"), to: join(client, "Presunuty2") },
      { operation: "copy", from: join(client, "poznamky.txt"), to: join(client, "Presunuty2", "Git", "HEAD") }], join(client, ".git")],
  ] as const) {
    const before = await readdir(guarded);
    const plan = await planFileOperations(config, workspace, operations);
    const result = await applyFileOperations(config, workspace, operations, plan.operations, plan.revision);
    expect(result.results[1]).toMatchObject({ status: "failed" });
    expect(await readdir(guarded)).toEqual(before);
  }
});

test("a move never replaces a file that appeared after the approval check (review #221)", async () => {
  const { config, client, workspace } = await office();
  const step = (from: string, to: string, kind: "file" | "folder" = "file"): PlannedFileOperation =>
    ({ operation: "move", kind, from, to, source: join(client, from), target: join(client, to), sourceRoot: client });
  // An editor saved the target between the re-plan and the change.
  await writeFile(join(client, "nove.txt"), "SYN ulozene editorom");
  await expect(executePlannedFileOperation(config, step("poznamky.txt", "nove.txt"))).rejects.toMatchObject({ code: "file_operation_target_exists" });
  expect(await readFile(join(client, "nove.txt"), "utf8")).toBe("SYN ulozene editorom");
  expect(await readFile(join(client, "poznamky.txt"), "utf8")).toBe("SYN poznamky");
  await mkdir(join(client, "Archiv"));
  await expect(executePlannedFileOperation(config, step("Pripady", "Archiv", "folder"))).rejects.toMatchObject({ code: "file_operation_target_exists" });
  expect(await readFile(join(client, "Pripady", "M001", "zmluva.txt"), "utf8")).toBe("SYN zmluva");
  // A free target still moves; the file keeps its identity and content.
  await executePlannedFileOperation(config, step("poznamky.txt", "presunute.txt"));
  expect(await readFile(join(client, "presunute.txt"), "utf8")).toBe("SYN poznamky");
  expect(await readdir(client)).not.toContain("poznamky.txt");
});

test("moving a link renames the link itself and never gives this client a second name for the file it points to (review #221)", async () => {
  const { config, client, other } = await office();
  const step: PlannedFileOperation = { operation: "move", kind: "file", from: "odkaz.txt", to: "nove.txt", source: join(client, "odkaz.txt"), target: join(client, "nove.txt"), sourceRoot: client };
  await symlink(join(other, "tajne.txt"), join(client, "odkaz.txt"));
  await executePlannedFileOperation(config, step);
  expect((await lstat(join(client, "nove.txt"))).isSymbolicLink()).toBe(true);
  expect(await readlink(join(client, "nove.txt"))).toBe(join(other, "tajne.txt"));
  // The other client's file keeps a single name.
  expect((await stat(join(other, "tajne.txt"))).nlink).toBe(1);
  // A dangling link moves too.
  await symlink(join(client, "neexistuje.txt"), join(client, "odkaz.txt"));
  await executePlannedFileOperation(config, { ...step, to: "nove-2.txt", target: join(client, "nove-2.txt") });
  expect(await readlink(join(client, "nove-2.txt"))).toBe(join(client, "neexistuje.txt"));
});

/** A second volume for a real cross-device move: tmpfs on Linux, or `LAWOSS_TEST_OTHER_VOLUME` (e.g. a macOS RAM disk); else skipped. */
const otherVolume = process.env.LAWOSS_TEST_OTHER_VOLUME ?? (process.platform === "linux" ? "/dev/shm" : null);
const otherVolumeReady = otherVolume !== null && await access(otherVolume).then(() => true, () => false);
test.skipIf(!otherVolumeReady)("a move to a linked folder on another volume copies, verifies and sends the original to the Trash (review #221)", async () => {
  const { config, client, workspace } = await office();
  const remote = await realpath(await mkdtemp(join(otherVolume ?? tmpdir(), "lawoss-files-nas-")));
  roots.push(remote);
  await writeRuntimeOpencodeConfig(config, "ws_c001", () => ({ permission: { external_directory: { [`${remote}/*`]: "allow" } } }));
  const operations = [
    { operation: "move", from: join(client, "poznamky.txt"), to: join(remote, "poznamky.txt") },
    { operation: "move", from: join(client, "Pripady"), to: join(remote, "Pripady") },
  ];
  const plan = await planFileOperations(config, workspace, operations);
  const result = await applyFileOperations(config, workspace, operations, plan.operations, plan.revision);
  expect(result.complete).toBe(true);
  expect(await readFile(join(remote, "poznamky.txt"), "utf8")).toBe("SYN poznamky");
  expect(await readFile(join(remote, "Pripady", "M001", "zmluva.txt"), "utf8")).toBe("SYN zmluva");
  // The originals are recoverable in the client's own Trash folder (no desktop host in this test).
  for (const entry of result.results) expect(entry.trash).toMatch(new RegExp(`^${LAWOSS_TRASH_FOLDER}/`));
  expect(await readdir(client)).not.toContain("poznamky.txt");
});

// #223: zrušený chat (alebo odpojená požiadavka) nenechá na druhom disku polovičnú kópiu, z ktorej by opakovanie skončilo „target exists“.
test("a cancelled move to another drive removes its copy and keeps the original (#223)", async () => {
  const { config, client } = await office();
  const step = { operation: "move" as const, kind: "folder" as const, from: "Pripady", to: "Presunute", source: join(client, "Pripady"), target: join(client, "Presunute"), sourceRoot: client };
  const before = new AbortController();
  before.abort();
  await expect(moveAcrossVolumes(config, step, before.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(await readdir(client)).not.toContain("Presunute");
  // Zrušené počas kopírovania: kópia sa odstráni, originál ostáva a do Koša nejde nič.
  const during = new AbortController();
  const moving = moveAcrossVolumes(config, step, during.signal);
  during.abort();
  await expect(moving).rejects.toMatchObject({ name: "AbortError" });
  expect(await readdir(client)).not.toContain("Presunute");
  expect(await readdir(client)).not.toContain(LAWOSS_TRASH_FOLDER);
  expect(await readFile(join(client, "Pripady", "M001", "zmluva.txt"), "utf8")).toBe("SYN zmluva");
});

test("a move cancelled at its last check, after the copy is verified, keeps the original out of the Trash (#223, Codex)", async () => {
  const { config, client } = await office();
  await mkdir(join(client, "Druhe", "M001"), { recursive: true });
  await writeFile(join(client, "Druhe", "M001", "zmluva.txt"), "SYN zmluva");
  const step = (from: string) => ({ operation: "move" as const, kind: "folder" as const, from, to: `${from}-presun`, source: join(client, from), target: join(client, `${from}-presun`), sourceRoot: client });
  /** Counts the checks made while hashing; the chat stops right after the given one has passed. */
  const checks = (abortAt: number) => {
    const controller = new AbortController();
    let count = 0;
    const own = controller.signal.throwIfAborted.bind(controller.signal);
    controller.signal.throwIfAborted = () => {
      own();
      if (!new Error().stack?.includes("treeDigest")) return;
      count += 1;
      if (count === abortAt) controller.abort();
    };
    return { signal: controller.signal, count: () => count };
  };
  // A full move of an identical folder tells how many; the chat stops after the last one, while the last file is read.
  const full = checks(0);
  await moveAcrossVolumes(config, step("Pripady"), full.signal);
  expect(full.count()).toBeGreaterThan(0);
  const last = checks(full.count());
  await expect(moveAcrossVolumes(config, step("Druhe"), last.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(await readFile(join(client, "Druhe", "M001", "zmluva.txt"), "utf8")).toBe("SYN zmluva");
  expect(await readdir(client)).not.toContain("Druhe-presun");
});

test("a cancelled request runs no further step (#223)", async () => {
  const { config, client, workspace } = await office();
  const operations = [{ operation: "create_folder", path: join(client, "Novy") }];
  const plan = await planFileOperations(config, workspace, operations);
  const cancelled = new AbortController();
  cancelled.abort();
  const result = await applyFileOperations(config, workspace, operations, plan.operations, plan.revision, undefined, undefined, cancelled.signal);
  expect(result).toMatchObject({ complete: false, results: [{ status: "failed" }] });
  expect(await readdir(client)).not.toContain("Novy");
});

test("on Windows only the system drive's Recycle Bin is trusted; network and other drives use .lawoss-kos (review #221)", () => {
  expect(systemTrashReliable("C:\\Klienti\\C001\\a.pdf", "win32", "C:")).toBe(true);
  expect(systemTrashReliable("c:\\Klienti\\C001\\a.pdf", "win32", "C:")).toBe(true);
  expect(systemTrashReliable("Z:\\Klienti\\C001\\a.pdf", "win32", "C:")).toBe(false);
  expect(systemTrashReliable("\\\\nas\\share\\C001\\a.pdf", "win32", "C:")).toBe(false);
  expect(systemTrashReliable("\\\\?\\C:\\Klienti\\a.pdf", "win32", "C:")).toBe(false);
  expect(systemTrashReliable("/Volumes/NAS/C001/a.pdf", "darwin")).toBe(true);
});

test("a case-only rename of the same file is allowed and verified by its listed name", async () => {
  const { config, client, workspace } = await office();
  if (!await caseInsensitive(client)) return;
  const operations = [{ operation: "move", from: join(client, "poznamky.txt"), to: join(client, "Poznamky.txt") }];
  const plan = await planFileOperations(config, workspace, operations);
  expect(plan.operations).toEqual([{ operation: "move", kind: "file", from: "poznamky.txt", to: "Poznamky.txt" }]);
  expect(await applyFileOperations(config, workspace, operations, plan.operations, plan.revision)).toMatchObject({ complete: true });
  expect(await readdir(client)).toContain("Poznamky.txt");
  expect(await readdir(client)).not.toContain("poznamky.txt");
  // A different existing file is still never overwritten.
  await writeFile(join(client, "ine.txt"), "SYN");
  await expect(planFileOperations(config, workspace, [{ operation: "move", from: join(client, "ine.txt"), to: join(client, "POZNAMKY.txt") }]))
    .rejects.toMatchObject({ code: "file_operation_target_exists" });
});

test("names cannot forge card lines, same-named linked folders are told apart, large folders show a lower bound", async () => {
  const { root, config, client, workspace } = await office();
  expect(visibleName("a\nb‮txt.exe")).toBe("a\\u000ab\\u202etxt.exe");
  const tricky = "zmluva\nDo Koša: nič.txt";
  await writeFile(join(client, tricky), "SYN");
  const forged = await planFileOperations(config, workspace, [{ operation: "delete", path: join(client, tricky) }]);
  expect(forged.operations[0]?.from).toBe("zmluva\\u000aDo Koša: nič.txt");
  // Two linked folders called "Podklady".
  const first = join(root, "A", "Podklady"), second = join(root, "B", "Podklady");
  for (const folder of [first, second]) { await mkdir(folder, { recursive: true }); await writeFile(join(folder, "x.pdf"), "SYN"); }
  await writeRuntimeOpencodeConfig(config, "ws_c001", () => ({ permission: { external_directory: { [`${first}/*`]: "allow", [`${second}/*`]: "allow" } } }));
  const both = await planFileOperations(config, workspace, [{ operation: "delete", path: join(first, "x.pdf") }, { operation: "delete", path: join(second, "x.pdf") }]);
  expect(both.operations.map((item) => item.from)).toEqual(["A/Podklady/x.pdf", "B/Podklady/x.pdf"]);
  // More items than the survey counts: shown as a lower bound.
  const big = join(client, "Velky");
  await mkdir(big);
  await Promise.all(Array.from({ length: FOLDER_SURVEY_LIMIT + 5 }, (_, index) => writeFile(join(big, `f${index}.txt`), "")));
  const large = await planFileOperations(config, workspace, [{ operation: "delete", path: big }]);
  expect(large.operations[0]).toMatchObject({ kind: "folder", entries: FOLDER_SURVEY_LIMIT, entriesCapped: true });
});

test("only the chat's own tool credential reaches the routes; a spoofed client ID does not", async () => {
  const { config, client, linked } = await office();
  config.approval = { mode: "manual", timeoutMs: 1000 };
  const server = await startServer(config);
  stops.push(() => server.stop());
  await grantWikiAgentSession(config, { sessionId: "ses_1", directory: client, scope: "collaborator" });
  const agent = { "x-legalwork-wiki-agent-token": await ensureWikiAgentToken(config), "x-legalwork-wiki-agent-session": "ses_1",
    "x-legalwork-wiki-agent-directory": encodeURIComponent(client) };
  const post = (route: string, body: unknown, headers: Record<string, string>) => fetch(`http://127.0.0.1:${server.port}/workspace/ws_c001/lawoss/files/${route}`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
  const operations = [{ operation: "move", from: join(client, "poznamky.txt"), to: join(client, "x.txt") }];
  // A client token, also one that claims to be the engine through its client-ID header.
  const bearers: Array<Record<string, string>> = [{ authorization: "Bearer owt_files_client" }, { authorization: "Bearer owt_files_client", "x-legalwork-client-id": "wiki-agent:spoof" }];
  for (const headers of bearers) {
    const refused = await post("plan", { operations }, headers);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "file_operation_agent_only" });
    const linkedDelete = [{ operation: "delete", path: join(linked, "podklad.pdf") }];
    expect((await post("apply", { operations: linkedDelete, approved: [{ operation: "delete", kind: "file", from: "pripojeny-A/podklad.pdf" }], revision: "x" }, headers)).status).toBe(403);
  }
  expect(await readFile(join(linked, "podklad.pdf"), "utf8")).toBe("SYN pdf");
  const planned = await post("plan", { operations }, agent);
  expect(planned.status).toBe(200);
  const { operations: approved, revision } = await planned.json();
  expect((await post("plan", { operations: [] }, agent)).status).toBe(400);
  // The apply names the chat that showed the card.
  expect((await post("apply", { operations, approved, revision, sessionID: "ses_other" }, agent)).status).toBe(403);
  config.readOnly = true;
  expect((await post("apply", { operations, approved, revision, sessionID: "ses_1" }, agent)).status).toBe(403);
  config.readOnly = false;
  expect(await readFile(join(client, "poznamky.txt"), "utf8")).toBe("SYN poznamky");
  const applied = await post("apply", { operations, approved, revision, sessionID: "ses_1" }, agent);
  expect(await applied.json()).toMatchObject({ complete: true, results: [{ status: "done", to: "x.txt" }] });
  expect(await readFile(join(client, "x.txt"), "utf8")).toBe("SYN poznamky");
});

test("an existing target name tells the agent to propose another name, at plan and at apply (P6, V10d)", async () => {
  const { config, client, workspace } = await office();
  await writeFile(join(client, "zmluva.pdf"), "SYN obsadene");
  await writeFile(join(client, "podklad.pdf"), "SYN podklad");
  const clash = planFileOperations(config, workspace, [{ operation: "move", from: join(client, "podklad.pdf"), to: join(client, "zmluva.pdf") }]);
  await expect(clash).rejects.toMatchObject({ code: "file_operation_target_exists" });
  await expect(clash).rejects.toThrow(/Propose a different name to the user, for example with the date or "\(2\)"/);
  await expect(planFileOperations(config, workspace, [{ operation: "create_folder", path: join(client, "Pripady") }])).rejects.toThrow(/Propose a different name/);
  // The name taken between the card and the change (apply-time check).
  const operations = [{ operation: "move", from: join(client, "podklad.pdf"), to: join(client, "nove.pdf") }];
  const plan = await planFileOperations(config, workspace, operations);
  await writeFile(join(client, "nove.pdf"), "SYN medzitym");
  await expect(applyFileOperations(config, workspace, operations, plan.operations, plan.revision)).rejects.toThrow(/Propose a different name/);
  expect(await readFile(join(client, "zmluva.pdf"), "utf8")).toBe("SYN obsadene");
});

test("N-A5-1: the card names a similar item next to the one deleted or moved, so the user sees which one goes", async () => {
  const { config, client, workspace } = await office();
  const folder = join(client, "Pripady", "M004");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "Podklady.pdf"), "SYN pdf");
  await writeFile(join(folder, "podklad.pdf"), "SYN pdf");
  await writeFile(join(folder, "faktura.pdf"), "SYN faktura");
  const remove = await planFileOperations(config, workspace, [{ operation: "delete", path: join(folder, "podklad.pdf") }]);
  expect(remove.operations).toEqual([{ operation: "delete", kind: "file", from: "Pripady/M004/podklad.pdf", similar: ["Podklady.pdf"] }]);
  const rename = await planFileOperations(config, workspace, [{ operation: "move", from: join(folder, "Podklady.pdf"), to: join(folder, "zmluva.pdf") }]);
  expect(rename.operations[0]?.similar).toEqual(["podklad.pdf"]);
  // No similar name: nothing extra on the card; a copy keeps the original, so it needs no warning.
  expect((await planFileOperations(config, workspace, [{ operation: "delete", path: join(folder, "faktura.pdf") }])).operations[0]).not.toHaveProperty("similar");
  expect((await planFileOperations(config, workspace, [{ operation: "copy", from: join(folder, "podklad.pdf"), to: join(folder, "kopia.pdf") }])).operations[0]).not.toHaveProperty("similar");
  // The approved plan still runs, and the right file goes to the Trash.
  const result = await applyFileOperations(config, workspace, [{ operation: "delete", path: join(folder, "podklad.pdf") }], remove.operations, remove.revision, "ses_1");
  expect(result.complete).toBe(true);
  expect((await readdir(folder)).sort()).toEqual(["Podklady.pdf", "faktura.pdf"]);
});

test("N-A5-1: confusable names differ only by case, accents or a letter or two, with the same extension", () => {
  expect(confusableNames("podklad.pdf", "Podklady.pdf")).toBe(true);
  expect(confusableNames("zmluva.docx", "Zmluva.DOCX")).toBe(true);
  expect(confusableNames("vyjadrenie.pdf", "vyjadrenie2.pdf")).toBe(true);
  expect(confusableNames("Uznesenie.pdf", "uznesenie.pdf".normalize("NFD"))).toBe(true);
  expect(confusableNames("Žaloba.pdf", "zaloba.pdf")).toBe(true);
  expect(confusableNames("podklad.pdf", "podklad.docx")).toBe(false);
  expect(confusableNames("zmluva.pdf", "faktura.pdf")).toBe(false);
  expect(confusableNames("a1.pdf", "a2.pdf")).toBe(false);
  expect(confusableNames("Podklady.pdf", "Podklady.pdf".normalize("NFD"))).toBe(false);
});

test("review N-A5-1: the item itself in another case is no neighbour, and a neighbour arriving after the card does not refuse the change", async () => {
  const { config, client, workspace } = await office();
  const folder = join(client, "Pripady", "M005");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "podklad.pdf"), "SYN pdf");
  await writeFile(join(folder, "Podklady.docx"), "SYN docx");
  await writeFile(join(folder, "~$dklady.docx"), "lock");
  if (await caseInsensitive(folder)) {
    const upper = await planFileOperations(config, workspace, [{ operation: "delete", path: join(folder, "PODKLAD.pdf") }]);
    expect(upper.operations[0]).not.toHaveProperty("similar");
  }
  // An Office lock file is not an item the user could mean.
  expect((await planFileOperations(config, workspace, [{ operation: "delete", path: join(folder, "Podklady.docx") }])).operations[0]).not.toHaveProperty("similar");
  const operations = [{ operation: "delete", path: join(folder, "podklad.pdf") }];
  const plan = await planFileOperations(config, workspace, operations);
  expect(plan.operations[0]).not.toHaveProperty("similar");
  await writeFile(join(folder, "podklady.pdf"), "SYN novy sken");
  const result = await applyFileOperations(config, workspace, operations, plan.operations, plan.revision, "ses_1");
  expect(result.complete).toBe(true);
  expect(result.results[0]).toMatchObject({ status: "done", similar: ["podklady.pdf"] });
  expect((await readdir(folder)).sort()).toEqual(["Podklady.docx", "podklady.pdf", "~$dklady.docx"]);
});

test("N-A5-10: a case written as its code alone resolves to its folder; several matches are refused, not guessed", async () => {
  const { config, client, workspace } = await office();
  const intake = join(client, "Spisy", "M001-uhrada-dodavok-riadiacich-jednotiek", "01_Podklady", "IN-007");
  await mkdir(intake, { recursive: true });
  await writeFile(join(intake, "poznamky.txt"), "SYN poznamky");
  const operations = [{ operation: "move", from: join(client, "Spisy", "M001", "01_Podklady", "IN-007", "poznamky.txt"), to: join(client, "Spisy", "M001", "01_Podklady", "IN-007", "poznamky-k-uhrade.txt") }];
  const plan = await planFileOperations(config, workspace, operations);
  expect(plan.operations).toEqual([{ operation: "move", kind: "file",
    from: "Spisy/M001-uhrada-dodavok-riadiacich-jednotiek/01_Podklady/IN-007/poznamky.txt",
    to: "Spisy/M001-uhrada-dodavok-riadiacich-jednotiek/01_Podklady/IN-007/poznamky-k-uhrade.txt" }]);
  const result = await applyFileOperations(config, workspace, operations, plan.operations, plan.revision, "ses_1");
  expect(result.complete).toBe(true);
  expect(await readdir(intake)).toEqual(["poznamky-k-uhrade.txt"]);
  // Two folders with the same code: refused with both names, nothing guessed.
  await mkdir(join(client, "Spisy", "M002 Spor A"), { recursive: true });
  await mkdir(join(client, "Spisy", "M002-spor-b"), { recursive: true });
  await expect(planFileOperations(config, workspace, [{ operation: "create_folder", path: join(client, "Spisy", "M002", "Nove") }]))
    .rejects.toMatchObject({ code: "file_operation_ambiguous_case", message: expect.stringContaining("M002 Spor A, M002-spor-b") });
  // A name that is not a code, or a code no folder starts with, is left as written.
  await expect(planFileOperations(config, workspace, [{ operation: "delete", path: join(client, "Spisy", "M009", "x.txt") }])).rejects.toMatchObject({ code: "file_operation_missing" });
  await expect(planFileOperations(config, workspace, [{ operation: "delete", path: join(client, "Spisy", "uhrada", "x.txt") }])).rejects.toMatchObject({ code: "file_operation_missing" });
  // Relative to the chat's folder, as the agent usually writes it.
  expect((await planFileOperations(config, workspace, [{ operation: "create_folder", path: "Spisy/M001/01_Podklady/Relativne" }])).operations[0]?.to)
    .toBe("Spisy/M001-uhrada-dodavok-riadiacich-jednotiek/01_Podklady/Relativne");
  // Review: names with a separator are not codes, even when one folder starts with them (FA 2024-storno, IN-007-faktura).
  await mkdir(join(client, "Faktury", "FA 2024-storno"), { recursive: true });
  await mkdir(join(intake, "..", "IN-008-faktura"), { recursive: true });
  expect((await planFileOperations(config, workspace, [{ operation: "create_folder", path: "Faktury/FA 2024/januar" }])).operations[0]?.to).toBe("Faktury/FA 2024/januar");
  expect((await planFileOperations(config, workspace, [{ operation: "create_folder", path: "Spisy/M001/01_Podklady/IN-008/novy" }])).operations[0]?.to)
    .toBe("Spisy/M001-uhrada-dodavok-riadiacich-jednotiek/01_Podklady/IN-008/novy");
  // Review: a file in the middle of the path is refused as before, not a server error.
  await expect(planFileOperations(config, workspace, [{ operation: "delete", path: join(intake, "poznamky-k-uhrade.txt", "x", "y.txt") }])).rejects.toMatchObject({ code: "file_operation_outside_client" });
  // M0010 is not M001 followed by a separator.
  await mkdir(join(client, "Spisy", "M0010-ine"), { recursive: true });
  expect((await planFileOperations(config, workspace, [{ operation: "create_folder", path: join(client, "Spisy", "M001", "Nove") }])).operations[0]?.to)
    .toBe("Spisy/M001-uhrada-dodavok-riadiacich-jednotiek/Nove");
});

test("a linked drive root is labelled by its drive on the card, never left blank like the client folder (review #221)", () => {
  expect(linkedFolderLabels(["Z:\\", "C:\\Data\\Podklady"], win32)).toEqual(["Z:", "Podklady"]);
  expect(linkedFolderLabels(["Z:\\", "Y:/"], win32)).toEqual(["Z:", "Y:"]);
  // UNC shares and ordinary folders keep their names; same names are still told apart by the parent.
  expect(linkedFolderLabels(["\\\\nas\\share", "D:\\A\\Spisy", "D:\\B\\Spisy"], win32)).toEqual(["share", "A/Spisy", "B/Spisy"]);
  expect(linkedFolderLabels(["/Volumes/NAS", "/mnt/x/NAS"], posix)).toEqual(["Volumes/NAS", "x/NAS"]);
  expect(linkedFolderLabels(["Z:\\"], win32).every(Boolean)).toBe(true);
});

test("#274: a nested client inside one of two case folders does not hide that case; the code stays ambiguous", async () => {
  const { config, client, workspace } = await office();
  const novak = join(client, "Spisy", "M001-Novak"), svoboda = join(client, "Spisy", "M001-Svoboda");
  for (const folder of [join(novak, "Podklady"), join(svoboda, "Podklady"), join(novak, "Spolocnost XY")]) await mkdir(folder, { recursive: true });
  await writeFile(join(svoboda, "Podklady", "zmluva.pdf"), "SYN Svoboda");
  config.workspaces.push({ id: "ws_xy", name: "Spolocnost XY", path: join(novak, "Spolocnost XY"), preset: "starter", workspaceType: "local" });
  await expect(planFileOperations(config, workspace, [{ operation: "delete", path: "Spisy/M001/Podklady/zmluva.pdf" }]))
    .rejects.toMatchObject({ code: "file_operation_ambiguous_case", message: expect.stringContaining("M001-Novak, M001-Svoboda") });
  // A case folder that is itself the nested client stays out of the comparison.
  await mkdir(join(client, "Spisy", "M002-Klient"), { recursive: true });
  await mkdir(join(client, "Spisy", "M002-Vec", "Podklady"), { recursive: true });
  config.workspaces.push({ id: "ws_m002", name: "M002", path: join(client, "Spisy", "M002-Klient"), preset: "starter", workspaceType: "local" });
  expect((await planFileOperations(config, workspace, [{ operation: "create_folder", path: "Spisy/M002/Podklady/Nove" }])).operations[0]?.to)
    .toBe("Spisy/M002-Vec/Podklady/Nove");
});

test("#274: a case code sees folders created or moved away earlier in the same request", async () => {
  const { config, client, workspace } = await office();
  await mkdir(join(client, "Spisy", "M001-stary"), { recursive: true });
  await mkdir(join(client, "Inbox"), { recursive: true });
  await writeFile(join(client, "Inbox", "a.pdf"), "SYN a");
  await expect(planFileOperations(config, workspace, [
    { operation: "create_folder", path: "Spisy/M001-novy" },
    { operation: "move", from: "Inbox/a.pdf", to: "Spisy/M001/a.pdf" },
  ])).rejects.toMatchObject({ code: "file_operation_ambiguous_case", message: expect.stringContaining("M001-novy, M001-stary") });
  // The only folder with the code moved away earlier: the code no longer names it.
  const plan = await planFileOperations(config, workspace, [
    { operation: "move", from: "Spisy/M001-stary", to: "Archiv-M001-stary" },
    { operation: "create_folder", path: "Spisy/M001/Nove" },
  ]);
  expect(plan.operations[1]?.to).toBe("Spisy/M001/Nove");
  // A folder created earlier is a candidate on its own.
  const created = await planFileOperations(config, workspace, [
    { operation: "move", from: "Spisy/M001-stary", to: "Archiv-M001-stary" },
    { operation: "create_folder", path: "Spisy/M001-novy" },
    { operation: "move", from: "Inbox/a.pdf", to: "Spisy/M001/a.pdf" },
  ]);
  expect(created.operations[2]?.to).toBe("Spisy/M001-novy/a.pdf");
  // Review: a folder created together with its parents counts too.
  await expect(planFileOperations(config, workspace, [
    { operation: "create_folder", path: "Spisy/M001-novy/Podklady" },
    { operation: "move", from: "Inbox/a.pdf", to: "Spisy/M001/a.pdf" },
  ])).rejects.toMatchObject({ code: "file_operation_ambiguous_case", message: expect.stringContaining("M001-novy, M001-stary") });
  // Review: a folder created with a child and then moved away is not a candidate any more.
  const away = await planFileOperations(config, workspace, [
    { operation: "create_folder", path: "Spisy/M001-novy" },
    { operation: "create_folder", path: "Spisy/M001-novy/Podklady" },
    { operation: "move", from: "Spisy/M001-novy", to: "Archiv-M001-novy" },
    { operation: "create_folder", path: "Spisy/M001/Nove" },
  ]);
  expect(away.operations[3]?.to).toBe("Spisy/M001-stary/Nove");
});

test.skipIf(process.platform !== "linux")("#274 review: moving one Unicode spelling away keeps its distinct sibling in the comparison", async () => {
  const { config, client, workspace } = await office();
  const nfc = "M001-Pošta".normalize("NFC"), nfd = "M001-Pošta".normalize("NFD");
  for (const name of [nfc, nfd, "M001-ine"]) await mkdir(join(client, "Spisy", name), { recursive: true });
  await expect(planFileOperations(config, workspace, [
    { operation: "move", from: join(client, "Spisy", nfc), to: join(client, "Archiv") },
    { operation: "create_folder", path: "Spisy/M001/Nove" },
  ])).rejects.toMatchObject({ code: "file_operation_ambiguous_case" });
});

/** N-A7-6: a synthetic case with a card, its input register (one row) and an inbox folder, like the OKF template. */
async function caseWithInbox(client: string) {
  const matter = join(client, "Spisy", "M001-najom-skladu-SYN");
  for (const folder of ["00_Na_zatriedenie", "01_Podklady", "02_Resers"]) await mkdir(join(matter, folder), { recursive: true });
  await writeFile(join(client, "klient.md"), "---\ntype: client\n---\n");
  await writeFile(join(matter, "spis.md"), "---\ntype: matter\n---\n");
  const register = ["---", "type: input-register", "---", "", "# Vstupy a komunikácia", "",
    "| ID | Prijaté | Zdroj | Originál | Stav | Výsledné záznamy |", "|---|---|---|---|---|---|",
    "| IN-001 | 2025-09-01T09:00:00+02:00 | e-mail SYN | 01_Podklady/zmluva-SYN.pdf | processed | MEM-1 |", "", "## Pracovné súbory", ""].join("\n");
  await writeFile(join(matter, "VSTUPY.md"), register);
  await writeFile(join(matter, "01_Podklady", "zmluva-SYN.pdf"), "SYN zmluva");
  await writeFile(join(matter, "00_Na_zatriedenie", "scan_rozhodnutie_SYN.pdf"), "SYN sken");
  return { matter, register };
}

async function run(config: ServerConfig, workspace: ServerConfig["workspaces"][number], operations: unknown[]) {
  const plan = await planFileOperations(config, workspace, operations);
  return applyFileOperations(config, workspace, operations, plan.operations, plan.revision, "ses_1");
}

test("N-A7-6: a file moved from the case's inbox into the case gets one pending row in the case's VSTUPY.md, and the move is audited", async () => {
  const { config, client, workspace } = await office();
  const { matter, register } = await caseWithInbox(client);
  // As the agent wrote it in D2: the case by its code, relative to the client's folder.
  const result = await run(config, workspace, [{ operation: "move", from: "Spisy/M001/00_Na_zatriedenie/scan_rozhodnutie_SYN.pdf", to: "Spisy/M001/01_Podklady/2025-09-20_rozhodnutie-sudu.pdf" }]);
  expect(result.complete).toBe(true);
  expect(result.results[0]).toMatchObject({ status: "done", input: { register: "Spisy/M001-najom-skladu-SYN/VSTUPY.md", id: "IN-002" } });
  const after = await readFile(join(matter, "VSTUPY.md"), "utf8");
  const added = after.split("\n").filter((line) => !register.split("\n").includes(line));
  expect(added).toHaveLength(1);
  expect(added[0]).toMatch(/^\| IN-002 \| \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} \| presun z priečinka na nezaradené \(LAWOSS\): `00_Na_zatriedenie\/scan_rozhodnutie_SYN\.pdf` \| 01_Podklady\/2025-09-20_rozhodnutie-sudu\.pdf \| pending \| \|$/);
  // The row is in the table, right after the last row; the text below the table stays.
  expect(after.split("\n").indexOf(added[0]!)).toBe(register.split("\n").indexOf("| IN-001 | 2025-09-01T09:00:00+02:00 | e-mail SYN | 01_Podklady/zmluva-SYN.pdf | processed | MEM-1 |") + 1);
  expect(after).toContain("## Pracovné súbory");
  // The model is told the row exists, so it does not write a second one.
  expect(fileOperationReport(result).join(" ")).toContain("recorded in Spisy/M001-najom-skladu-SYN/VSTUPY.md as input IN-002 with status pending");
  // T6: the approved move and the register line are in the server audit.
  const audit = (await readFile(auditLogPath("ws_c001"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  expect(audit.map((entry) => entry.summary)).toEqual([
    "lawoss_files: Moved Spisy/M001-najom-skladu-SYN/00_Na_zatriedenie/scan_rozhodnutie_SYN.pdf to Spisy/M001-najom-skladu-SYN/01_Podklady/2025-09-20_rozhodnutie-sudu.pdf",
    "lawoss_files: Added input IN-002 in Spisy/M001-najom-skladu-SYN/VSTUPY.md",
  ]);
  expect(audit[0]).toMatchObject({ workspaceId: "ws_c001", action: "workspace.file.write", target: join(matter, "01_Podklady", "2025-09-20_rozhodnutie-sudu.pdf") });
  expect(audit[1]).toMatchObject({ action: "workspace.file.write", target: join(matter, "VSTUPY.md") });
  // No canonical path reaches the model.
  expect(JSON.stringify(result)).not.toContain(client);

  // A move inside the case that does not come from an inbox adds nothing; N-A8-1: the listed file's row follows it.
  const inside = await run(config, workspace, [{ operation: "move", from: "Spisy/M001/01_Podklady/zmluva-SYN.pdf", to: "Spisy/M001/02_Resers/zmluva-SYN.pdf" }]);
  expect(inside.results[0]).toEqual({ operation: "move", kind: "file", from: "Spisy/M001-najom-skladu-SYN/01_Podklady/zmluva-SYN.pdf", to: "Spisy/M001-najom-skladu-SYN/02_Resers/zmluva-SYN.pdf", status: "done",
    input: { register: "Spisy/M001-najom-skladu-SYN/VSTUPY.md", id: "IN-001", updated: true } });
  expect(await readFile(join(matter, "VSTUPY.md"), "utf8")).toBe(after.replace("| 01_Podklady/zmluva-SYN.pdf |", "| 02_Resers/zmluva-SYN.pdf |"));
});

test("N-A7-6: from the client's inbox a new row; a file the app already registered keeps its row; into an inbox, a folder or outside a case nothing", async () => {
  const { config, client, workspace } = await office();
  const { matter } = await caseWithInbox(client);
  await mkdir(join(client, "00_Na_zatriedenie", "balik"), { recursive: true });
  await writeFile(join(client, "00_Na_zatriedenie", "posta | SYN.pdf"), "SYN posta");
  await writeFile(join(client, "00_Na_zatriedenie", "balik", "a.pdf"), "SYN a");
  await mkdir(join(matter, "00_K_zarazeni", "IN-002"), { recursive: true });
  await writeFile(join(matter, "00_K_zarazeni", "IN-002", "zmluva v2.pdf"), "SYN v2");
  const appRow = "| IN-002 | 2025-09-02T10:00:00+02:00 | ruční vložení (LAWOSS) | 00_K_zarazeni/IN-002/zmluva v2.pdf | pending | |";
  await writeFile(join(matter, "VSTUPY.md"), `${await readFile(join(matter, "VSTUPY.md"), "utf8")}`.replace("| MEM-1 |\n", `| MEM-1 |\n${appRow}\n`));

  const result = await run(config, workspace, [
    { operation: "move", from: join(client, "00_Na_zatriedenie", "posta | SYN.pdf"), to: join(matter, "01_Podklady", "posta | SYN.pdf") },
    { operation: "move", from: join(matter, "00_K_zarazeni", "IN-002", "zmluva v2.pdf"), to: join(matter, "01_Podklady", "zmluva v2.pdf") },
    { operation: "move", from: join(client, "00_Na_zatriedenie", "balik"), to: join(matter, "01_Podklady", "balik") },
    { operation: "copy", from: join(matter, "01_Podklady", "zmluva-SYN.pdf"), to: join(matter, "00_Na_zatriedenie", "zmluva-kopia.pdf") },
    { operation: "copy", from: join(matter, "01_Podklady", "zmluva-SYN.pdf"), to: join(client, "zmluva-kopia.pdf") },
  ]);
  expect(result.complete).toBe(true);
  expect(result.results.map((item) => item.input ?? null)).toEqual([
    { register: "Spisy/M001-najom-skladu-SYN/VSTUPY.md", id: "IN-003" },
    { register: "Spisy/M001-najom-skladu-SYN/VSTUPY.md", id: "IN-002", updated: true },
    null, null, null,
  ]);
  const rows = (await readFile(join(matter, "VSTUPY.md"), "utf8")).split("\n").filter((line) => line.startsWith("| IN-"));
  expect(rows).toHaveLength(3);
  // The app's row now names the file where it lies; its ID, source and state stay.
  expect(rows[1]).toBe("| IN-002 | 2025-09-02T10:00:00+02:00 | ruční vložení (LAWOSS) | 01_Podklady/zmluva v2.pdf | pending | |");
  // A name with "|" does not break the table: a link with an encoded target, the source without the character.
  expect(rows[2]).toContain("| presun z priečinka na nezaradené (LAWOSS): `00_Na_zatriedenie/posta   SYN.pdf` | [posta  SYN.pdf](./01_Podklady/posta%20%7C%20SYN.pdf) | pending | |");
  expect(rows[2]!.split("|")).toHaveLength(8);
});

test("review #292: a file the app registered in case A and moved to case B gets a row in B; A's row is closed with a reference, not left pending", async () => {
  const { config, client, workspace } = await office();
  const { matter } = await caseWithInbox(client);
  const other = join(client, "Spisy", "M002-spor-SYN");
  await mkdir(join(other, "01_Podklady"), { recursive: true });
  await writeFile(join(other, "spis.md"), "---\ntype: matter\n---\n");
  await mkdir(join(matter, "00_K_zarazeni", "IN-002"), { recursive: true });
  await writeFile(join(matter, "00_K_zarazeni", "IN-002", "vyzva.pdf"), "SYN vyzva");
  const appRow = "| IN-002 | 2025-09-02T10:00:00+02:00 | ruční vložení (LAWOSS) | 00_K_zarazeni/IN-002/vyzva.pdf | pending | |";
  await writeFile(join(matter, "VSTUPY.md"), (await readFile(join(matter, "VSTUPY.md"), "utf8")).replace("| MEM-1 |\n", `| MEM-1 |\n${appRow}\n`));

  const result = await run(config, workspace, [{ operation: "move", from: join(matter, "00_K_zarazeni", "IN-002", "vyzva.pdf"), to: join(other, "01_Podklady", "vyzva.pdf") }]);
  expect(result.results[0]?.input).toEqual({ register: "Spisy/M002-spor-SYN/VSTUPY.md", id: "IN-001",
    handedOver: { register: "Spisy/M001-najom-skladu-SYN/VSTUPY.md", id: "IN-002" } });
  // B had no register: it is created with the row.
  const created = await readFile(join(other, "VSTUPY.md"), "utf8");
  expect(created.split("\n").filter((line) => line.startsWith("| IN-"))).toEqual([
    expect.stringMatching(/^\| IN-001 \| .+ \| presun z priečinka na nezaradené \(LAWOSS\): `Spisy\/M001-najom-skladu-SYN\/00_K_zarazeni\/IN-002\/vyzva\.pdf` \| 01_Podklady\/vyzva\.pdf \| pending \| \|$/),
  ]);
  // A's row: ID and source stay, the link follows the file, the decision says where it went.
  const closed = (await readFile(join(matter, "VSTUPY.md"), "utf8")).split("\n").filter((line) => line.startsWith("| IN-"));
  expect(closed).toEqual([
    "| IN-001 | 2025-09-01T09:00:00+02:00 | e-mail SYN | 01_Podklady/zmluva-SYN.pdf | processed | MEM-1 |",
    "| IN-002 | 2025-09-02T10:00:00+02:00 | ruční vložení (LAWOSS) | ../M002-spor-SYN/01_Podklady/vyzva.pdf | processed | presunuté do `Spisy/M002-spor-SYN/VSTUPY.md`, IN-001 |",
  ]);
  expect(fileOperationReport(result).join(" ")).toContain("Its earlier input IN-002 in Spisy/M001-najom-skladu-SYN/VSTUPY.md is closed as moved there.");
  const audit = (await readFile(auditLogPath("ws_c001"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  expect(audit.map((entry) => entry.target)).toEqual([join(other, "01_Podklady", "vyzva.pdf"), join(other, "VSTUPY.md"), join(matter, "VSTUPY.md")]);
});

test("review #292: the source path is a code span, not a link or HTML, and a register that is a symbolic link is neither read nor replaced", async () => {
  const { config, client, root, workspace } = await office();
  const { matter } = await caseWithInbox(client);
  const name = "[klik](e) <img src=x> `kod`.pdf";
  await writeFile(join(matter, "00_Na_zatriedenie", name), "SYN");
  const result = await run(config, workspace, [{ operation: "move", from: join(matter, "00_Na_zatriedenie", name), to: join(matter, "01_Podklady", name) }]);
  expect(result.results[0]?.input?.id).toBe("IN-002");
  const row = (await readFile(join(matter, "VSTUPY.md"), "utf8")).split("\n").find((line) => line.startsWith("| IN-002"))!;
  // Zdroj: code span with a fence longer than the backticks inside. Originál: plain link text, the whole target encoded.
  expect(row).toContain("| presun z priečinka na nezaradené (LAWOSS): ``00_Na_zatriedenie/[klik](e) <img src=x> `kod`.pdf`` | [klik(e) img src=x kod.pdf](./01_Podklady/%5Bklik%5D%28e%29%20%3Cimg%20src%3Dx%3E%20%60kod%60.pdf) | pending | |");

  // A register replaced by a link to a file elsewhere: the move is done, the register is reported as not updated.
  const elsewhere = join(root, "mimo-SYN.md");
  await writeFile(elsewhere, "SYN mimo");
  await rm(join(matter, "VSTUPY.md"));
  await symlink(elsewhere, join(matter, "VSTUPY.md"));
  await writeFile(join(matter, "00_Na_zatriedenie", "druhy-SYN.pdf"), "SYN");
  const linked = await run(config, workspace, [{ operation: "move", from: join(matter, "00_Na_zatriedenie", "druhy-SYN.pdf"), to: join(matter, "01_Podklady", "druhy-SYN.pdf") }]);
  expect(linked.complete).toBe(true);
  expect(linked.results[0]?.status).toBe("done");
  expect(linked.results[0]?.inputError).toContain("not a regular file");
  expect(linked.results[0]?.input).toBeUndefined();
  expect(await readFile(elsewhere, "utf8")).toBe("SYN mimo");
  expect((await lstat(join(matter, "VSTUPY.md"))).isSymbolicLink()).toBe(true);
  expect(fileOperationReport(linked).join(" ")).toContain("could not be updated");
});

test("N-A8-1: renaming a file the case's VSTUPY.md lists moves its link in the existing row; nothing is added, other rows and unlisted files stay", async () => {
  const { config, client, workspace } = await office();
  const { matter } = await caseWithInbox(client);
  await mkdir(join(matter, "01_Podklady", "IN-003"), { recursive: true });
  await writeFile(join(matter, "01_Podklady", "IN-003", "Podklady.pdf"), "SYN podklady");
  await writeFile(join(matter, "01_Podklady", "poznamka-SYN.pdf"), "SYN poznamka");
  const listed = "| IN-003 | 2025-09-03T08:00:00+02:00 | ruční vložení (LAWOSS) | ./01_Podklady/IN-003/Podklady.pdf | processed | MEM-2 |";
  await writeFile(join(matter, "VSTUPY.md"), (await readFile(join(matter, "VSTUPY.md"), "utf8")).replace("| MEM-1 |\n", `| MEM-1 |\n${listed}\n`));
  const before = await readFile(join(matter, "VSTUPY.md"), "utf8");

  // The same server call runs after the card and in YOLO Mode (the tool only skips the card there).
  const result = await run(config, workspace, [
    { operation: "move", from: "Spisy/M001/01_Podklady/IN-003/Podklady.pdf", to: "Spisy/M001/01_Podklady/IN-003/2025-03-10_Podklady.pdf" },
    { operation: "move", from: "Spisy/M001/01_Podklady/poznamka-SYN.pdf", to: "Spisy/M001/01_Podklady/2025-03-11_poznamka-SYN.pdf" },
    { operation: "copy", from: "Spisy/M001/01_Podklady/zmluva-SYN.pdf", to: "Spisy/M001/02_Resers/zmluva-SYN.pdf" },
  ]);
  expect(result.complete).toBe(true);
  expect(result.results.map((item) => item.input ?? null)).toEqual([
    { register: "Spisy/M001-najom-skladu-SYN/VSTUPY.md", id: "IN-003", updated: true }, null, null,
  ]);
  const after = await readFile(join(matter, "VSTUPY.md"), "utf8");
  // Only the link of IN-003 changed: its ID, source, state and records stay; no row is added.
  expect(after).toBe(before.replace("| ./01_Podklady/IN-003/Podklady.pdf |", "| 01_Podklady/IN-003/2025-03-10_Podklady.pdf |"));
  expect(after.split("\n").filter((line) => line.startsWith("| IN-"))).toHaveLength(2);
  expect(fileOperationReport(result).join(" ")).toContain("its existing input IN-003 in Spisy/M001-najom-skladu-SYN/VSTUPY.md now points to the new place. Do not add another row for this file.");
  const audit = (await readFile(auditLogPath("ws_c001"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  expect(audit.map((entry) => entry.summary)).toContain("lawoss_files: Updated input IN-003 in Spisy/M001-najom-skladu-SYN/VSTUPY.md");

  // Renamed again, now to another folder of the case: the row follows; the client's register follows its own row too.
  await writeFile(join(client, "VSTUPY.md"), ["| ID | Prijaté | Zdroj | Originál | Stav | Výsledné záznamy |", "|---|---|---|---|---|---|",
    "| IN-001 | 2025-09-04T08:00:00+02:00 | e-mail SYN | Spisy/M001-najom-skladu-SYN/01_Podklady/IN-003/2025-03-10_Podklady.pdf | processed | |", ""].join("\n"));
  const again = await run(config, workspace, [{ operation: "move", from: "Spisy/M001/01_Podklady/IN-003/2025-03-10_Podklady.pdf", to: "Spisy/M001/02_Resers/2025-03-10_Podklady.pdf" }]);
  expect(again.results[0]?.input).toEqual({ register: "Spisy/M001-najom-skladu-SYN/VSTUPY.md", id: "IN-003", updated: true, also: [{ register: "VSTUPY.md", id: "IN-001" }] });
  expect(fileOperationReport(again).join(" ")).toContain("its existing inputs IN-003 in Spisy/M001-najom-skladu-SYN/VSTUPY.md, IN-001 in VSTUPY.md now point to the new place.");
  expect(await readFile(join(matter, "VSTUPY.md"), "utf8")).toBe(before.replace("| ./01_Podklady/IN-003/Podklady.pdf |", "| 02_Resers/2025-03-10_Podklady.pdf |"));
  expect(await readFile(join(client, "VSTUPY.md"), "utf8")).toContain("| IN-001 | 2025-09-04T08:00:00+02:00 | e-mail SYN | Spisy/M001-najom-skladu-SYN/02_Resers/2025-03-10_Podklady.pdf | processed | |");
});

test("N-A8-1: a register that is a symbolic link is neither read nor changed by a rename, and the rename is not reported as failed", async () => {
  const { config, client, root, workspace } = await office();
  const { matter } = await caseWithInbox(client);
  const elsewhere = join(root, "mimo-SYN.md");
  await writeFile(elsewhere, "| IN-009 | x | y | 01_Podklady/zmluva-SYN.pdf | pending | |\n");
  await rm(join(matter, "VSTUPY.md"));
  await symlink(elsewhere, join(matter, "VSTUPY.md"));
  const result = await run(config, workspace, [{ operation: "move", from: "Spisy/M001/01_Podklady/zmluva-SYN.pdf", to: "Spisy/M001/01_Podklady/zmluva-2-SYN.pdf" }]);
  expect(result.results[0]).toEqual({ operation: "move", kind: "file", from: "Spisy/M001-najom-skladu-SYN/01_Podklady/zmluva-SYN.pdf", to: "Spisy/M001-najom-skladu-SYN/01_Podklady/zmluva-2-SYN.pdf", status: "done" });
  expect(await readFile(elsewhere, "utf8")).toBe("| IN-009 | x | y | 01_Podklady/zmluva-SYN.pdf | pending | |\n");
});

test("N-A8-1 (a): renaming or moving a folder moves the links of every listed file in it, in the case's and the client's register", async () => {
  const { config, client, workspace } = await office();
  const { matter } = await caseWithInbox(client);
  for (const folder of ["IN-003", "IN-0030"]) await mkdir(join(matter, "01_Podklady", folder), { recursive: true });
  await writeFile(join(matter, "01_Podklady", "IN-003", "Podklady.pdf"), "SYN podklady");
  await writeFile(join(matter, "01_Podklady", "IN-003", "b v2.pdf"), "SYN b");
  await writeFile(join(matter, "01_Podklady", "IN-0030", "x.pdf"), "SYN x");
  const rows = [
    "| IN-003 | 2025-09-03T08:00:00+02:00 | ruční vložení (LAWOSS) | ./01_Podklady/IN-003/Podklady.pdf | processed | MEM-2 |",
    "| IN-004 | 2025-09-04T08:00:00+02:00 | ruční vložení (LAWOSS) | [b v2.pdf](./01_Podklady/IN-003/b%20v2.pdf) | pending | |",
    "| IN-005 | 2025-09-05T08:00:00+02:00 | e-mail SYN | 01_Podklady/IN-0030/x.pdf | pending | |",
  ];
  await writeFile(join(matter, "VSTUPY.md"), (await readFile(join(matter, "VSTUPY.md"), "utf8")).replace("| MEM-1 |\n", `| MEM-1 |\n${rows.join("\n")}\n`));
  await writeFile(join(client, "VSTUPY.md"), ["| ID | Prijaté | Zdroj | Originál | Stav | Výsledné záznamy |", "|---|---|---|---|---|---|",
    "| IN-001 | 2025-09-06T08:00:00+02:00 | e-mail SYN | Spisy/M001-najom-skladu-SYN/01_Podklady/IN-003/Podklady.pdf | processed | |", ""].join("\n"));
  const before = await readFile(join(matter, "VSTUPY.md"), "utf8");

  const renamed = await run(config, workspace, [{ operation: "move", from: "Spisy/M001/01_Podklady/IN-003", to: "Spisy/M001/01_Podklady/IN-003_zmluva" }]);
  expect(renamed.complete).toBe(true);
  expect(renamed.results[0]?.input).toEqual({ register: "Spisy/M001-najom-skladu-SYN/VSTUPY.md", id: "IN-003", updated: true,
    also: [{ register: "Spisy/M001-najom-skladu-SYN/VSTUPY.md", id: "IN-004" }, { register: "VSTUPY.md", id: "IN-001" }] });
  const after = await readFile(join(matter, "VSTUPY.md"), "utf8");
  // Both files in the folder follow it; IN-0030 only starts with the same letters and stays; nothing is added.
  expect(after).toBe(before.replace("| ./01_Podklady/IN-003/Podklady.pdf |", "| 01_Podklady/IN-003_zmluva/Podklady.pdf |")
    .replace("| [b v2.pdf](./01_Podklady/IN-003/b%20v2.pdf) |", "| 01_Podklady/IN-003_zmluva/b v2.pdf |"));
  expect(await readFile(join(client, "VSTUPY.md"), "utf8")).toContain("| Spisy/M001-najom-skladu-SYN/01_Podklady/IN-003_zmluva/Podklady.pdf | processed |");
  expect(fileOperationReport(renamed).join(" ")).toContain("its existing inputs IN-003 in Spisy/M001-najom-skladu-SYN/VSTUPY.md, IN-004 in Spisy/M001-najom-skladu-SYN/VSTUPY.md, IN-001 in VSTUPY.md now point to the new place.");
  const audit = (await readFile(auditLogPath("ws_c001"), "utf8")).trim().split("\n").map((line) => JSON.parse(line).summary);
  expect(audit).toContain("lawoss_files: Updated input IN-004 in Spisy/M001-najom-skladu-SYN/VSTUPY.md");
  expect(audit).toContain("lawoss_files: Updated input IN-001 in VSTUPY.md");

  // The case folder itself renamed: its own register moves with it and stays valid; the client's row follows.
  const moved = await run(config, workspace, [{ operation: "move", from: "Spisy/M001-najom-skladu-SYN", to: "Spisy/M001-najom-skladu-SYN-uzavrety" }]);
  expect(moved.results[0]?.input).toEqual({ register: "VSTUPY.md", id: "IN-001", updated: true });
  expect(await readFile(join(client, "Spisy", "M001-najom-skladu-SYN-uzavrety", "VSTUPY.md"), "utf8")).toBe(after);
  expect(await readFile(join(client, "VSTUPY.md"), "utf8")).toContain("| Spisy/M001-najom-skladu-SYN-uzavrety/01_Podklady/IN-003_zmluva/Podklady.pdf | processed |");
});

test("N-A8-1 (b): a move to a linked folder (NAS) writes the absolute path there, for a listed file and for one filed from the client's inbox", async () => {
  const { config, client, linked, workspace } = await office();
  const { matter } = await caseWithInbox(client);
  await mkdir(join(linked, "M009-SYN"), { recursive: true });
  await writeFile(join(linked, "M009-SYN", "spis.md"), "---\ntype: matter\n---\n");
  await mkdir(join(client, "00_Na_zatriedenie"), { recursive: true });
  await writeFile(join(client, "00_Na_zatriedenie", "posta-SYN.pdf"), "SYN posta");
  await writeFile(join(client, "VSTUPY.md"), ["| ID | Prijaté | Zdroj | Originál | Stav | Výsledné záznamy |", "|---|---|---|---|---|---|",
    "| IN-001 | 2025-09-06T08:00:00+02:00 | ruční vložení (LAWOSS) | 00_Na_zatriedenie/posta-SYN.pdf | pending | |", ""].join("\n"));
  const before = await readFile(join(matter, "VSTUPY.md"), "utf8");

  const result = await run(config, workspace, [
    { operation: "move", from: "Spisy/M001/01_Podklady/zmluva-SYN.pdf", to: join(linked, "Archiv", "zmluva-SYN.pdf") },
    { operation: "move", from: join(client, "00_Na_zatriedenie", "posta-SYN.pdf"), to: join(linked, "M009-SYN", "posta-SYN.pdf") },
  ]);
  expect(result.complete).toBe(true);
  expect(result.results[0]?.input).toEqual({ register: "Spisy/M001-najom-skladu-SYN/VSTUPY.md", id: "IN-001", updated: true });
  // The absolute path the user linked: the lawyer finds it, and the app does not read it as a path in the client's folder.
  expect(await readFile(join(matter, "VSTUPY.md"), "utf8")).toBe(before.replace("| 01_Podklady/zmluva-SYN.pdf |", `| \`${join(linked, "Archiv", "zmluva-SYN.pdf")}\` |`));
  // Filed into a case on the NAS: a new row there, and the client's row is closed with the new place, not left pending.
  expect(result.results[1]?.input).toEqual({ register: "pripojeny-A/M009-SYN/VSTUPY.md", id: "IN-001", handedOver: { register: "VSTUPY.md", id: "IN-001" } });
  expect(await readFile(join(client, "VSTUPY.md"), "utf8")).toContain(`| IN-001 | 2025-09-06T08:00:00+02:00 | ruční vložení (LAWOSS) | \`${join(linked, "M009-SYN", "posta-SYN.pdf")}\` | processed | presunuté do \`pripojeny-A/M009-SYN/VSTUPY.md\`, IN-001 |`);
  expect(await readFile(join(linked, "M009-SYN", "VSTUPY.md"), "utf8")).toContain("| posta-SYN.pdf | pending | |");
});

test("N-A8-1 (c): a listed file or folder sent to the Trash keeps its row, closed with where it went", async () => {
  const { config, client, workspace } = await office();
  const { matter } = await caseWithInbox(client);
  await mkdir(join(matter, "01_Podklady", "IN-003"), { recursive: true });
  await writeFile(join(matter, "01_Podklady", "IN-003", "Podklady.pdf"), "SYN podklady");
  const listed = "| IN-003 | 2025-09-03T08:00:00+02:00 | ruční vložení (LAWOSS) | ./01_Podklady/IN-003/Podklady.pdf | pending | |";
  await writeFile(join(matter, "VSTUPY.md"), (await readFile(join(matter, "VSTUPY.md"), "utf8")).replace("| MEM-1 |\n", `| MEM-1 |\n${listed}\n`));
  const before = await readFile(join(matter, "VSTUPY.md"), "utf8");

  // No system Trash here: the file goes to `.lawoss-kos/` in the client's folder, and the row points there.
  const deleted = await run(config, workspace, [{ operation: "delete", path: "Spisy/M001/01_Podklady/zmluva-SYN.pdf" }]);
  expect(deleted.complete).toBe(true);
  expect(deleted.results[0]?.input).toEqual({ register: "Spisy/M001-najom-skladu-SYN/VSTUPY.md", id: "IN-001", trashed: true });
  const trash = deleted.results[0]?.trash ?? "";
  expect(trash).toMatch(new RegExp(`^${LAWOSS_TRASH_FOLDER}/[^/]+/Spisy/M001-najom-skladu-SYN/01_Podklady/zmluva-SYN\\.pdf$`));
  const after = await readFile(join(matter, "VSTUPY.md"), "utf8");
  expect(after).toBe(before.replace("| 01_Podklady/zmluva-SYN.pdf | processed | MEM-1 |", `| ../../${trash} | processed | MEM-1; presunuté do Koša (skrytý priečinok .lawoss-kos) |`));
  expect(await readFile(join(matter, "..", "..", trash), "utf8")).toBe("SYN zmluva");
  expect(fileOperationReport(deleted).join(" ")).toContain("its input IN-001 in Spisy/M001-najom-skladu-SYN/VSTUPY.md stays in the register, closed as moved to the Trash.");
  const audit = (await readFile(auditLogPath("ws_c001"), "utf8")).trim().split("\n").map((line) => JSON.parse(line).summary);
  expect(audit).toContain("lawoss_files: Closed input IN-001 in Spisy/M001-najom-skladu-SYN/VSTUPY.md, moved to the Trash");

  // The system Trash: the row keeps the original place, where the Trash puts the item back, and is closed; a folder too.
  config.trashItem = async (path) => { await rm(path, { recursive: true }); };
  const folder = await run(config, workspace, [{ operation: "delete", path: "Spisy/M001/01_Podklady/IN-003" }]);
  expect(folder.results[0]).toMatchObject({ status: "done", trash: "system", input: { register: "Spisy/M001-najom-skladu-SYN/VSTUPY.md", id: "IN-003", trashed: true } });
  expect(await readFile(join(matter, "VSTUPY.md"), "utf8")).toBe(after.replace(listed, "| IN-003 | 2025-09-03T08:00:00+02:00 | ruční vložení (LAWOSS) | ./01_Podklady/IN-003/Podklady.pdf | processed | presunuté do Koša |"));
  expect((await readFile(join(matter, "VSTUPY.md"), "utf8")).split("\n").filter((line) => line.startsWith("| IN-"))).toHaveLength(2);
});
