// LAWOSS: lawoss_files na serveri – plán pre jednu kartu, vykonanie len schváleného plánu, pravdivý výsledok.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { ensureWikiAgentToken, grantWikiAgentSession } from "../wiki/agent-access.js";
import { fileOperationReport } from "../opencode-plugins/lawoss-file-operations-text.js";
import { applyFileOperations, confusableNames, executePlannedFileOperation, FOLDER_SURVEY_LIMIT, LAWOSS_TRASH_FOLDER, planFileOperations, systemTrashReliable, visibleName, type PlannedFileOperation } from "./file-operations.js";

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
  // M0010 is not M001 followed by a separator.
  await mkdir(join(client, "Spisy", "M0010-ine"), { recursive: true });
  expect((await planFileOperations(config, workspace, [{ operation: "create_folder", path: join(client, "Spisy", "M001", "Nove") }])).operations[0]?.to)
    .toBe("Spisy/M001-uhrada-dodavok-riadiacich-jednotiek/Nove");
});
