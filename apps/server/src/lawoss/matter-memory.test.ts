// LAWOSS alfa 2 (N-A3-3, MČ 23. 10. 2026): pamäť spisu sa číta bez shellu a bez karty, len v klientovi chatu
// a v jeho pripojených priečinkoch. Iný klient (aj vnorený, aj cez kartu klienta nad spisom) sa odmietne bez mena.
import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { FILE_BYTE_LIMIT, MATTER_MEMORY_PAGE, readMatterMemoryForChat, STORE_BYTE_LIMIT } from "./matter-memory.js";

const D = "2026-10-23";
const record = (id: string, type: string, layer: string, title: string, description: string, truth: string, status = "active") =>
  `---\nokf: 1\nid: ${id}\ntype: ${type}\ntitle: ${title}\ndescription: ${description}\nlayer: ${layer}\njurisdiction: sk\nstatus: ${status}\ncreated: ${D}\nupdated: ${D}\n---\n\n## Truth\n\n${truth}\n\n## History\n\n- ${D} — založené\n`;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

async function memory(dir: string, file: string, text: string) {
  await mkdir(join(dir, "memory"), { recursive: true });
  await writeFile(join(dir, "memory", file), text);
}

/** Synthetic practice: Office ban-list, client K1 with case M001, a client K2 registered inside K1, another client K3. */
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-matter-memory-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await memory(join(root, "Office"), "A-301.md", record("A-301", "authority", "L3", "Prekonaný výklad SYN", "SYN 1 VSPH 1/2024 necitovať", "t", "banned"));
  const k1 = join(root, "K1-Tatran"), m1 = join(k1, "Spisy", "M001");
  await mkdir(m1, { recursive: true });
  await writeFile(join(k1, "client.md"), "---\ntype: klient\n---\n");
  await memory(m1, "M-001.md", record("M-001", "matter", "L2", "Stav veci SYN", "SYN nájom", "SYN fakt 7311"));
  await writeFile(join(m1, "VSTUPY.md"), "# Vstupy\n\n| SYN-IN-001 | pending |\n");
  const nested = join(k1, "Vnoreny-Hron"), mn = join(nested, "Spisy", "M009");
  await mkdir(mn, { recursive: true });
  await writeFile(join(nested, "client.md"), "---\ntype: klient\n---\n");
  await memory(mn, "M-009.md", record("M-009", "matter", "L2", "Tajné SYN", "vnorený klient", "SECRET-NESTED-4401"));
  const k3 = join(root, "K3-Hron"), m3 = join(k3, "Spisy", "M003");
  await mkdir(m3, { recursive: true });
  await writeFile(join(k3, "client.md"), "---\ntype: klient\n---\n");
  await memory(m3, "M-003.md", record("M-003", "matter", "L2", "Cudzí SYN", "iný klient", "SECRET-OTHER-5502"));
  const workspace = (id: string, path: string): WorkspaceInfo => ({ id, name: id, path, preset: "starter", workspaceType: "local" });
  const own = workspace("ws_k1", k1), inner = workspace("ws_nested", nested), other = workspace("ws_k3", k3);
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture-host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: [own, inner, other], authorizedRoots: [k1, k3], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli",
    logFormat: "pretty", logRequests: false,
  };
  return { root, k1, m1, nested, mn, k3, m3, own, inner, other, config, workspace };
}

const none = async () => [];
const refusal = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) =>
  error && typeof error === "object" && "code" in error ? { code: String(error.code), message: String("message" in error ? error.message : ""), status: "status" in error ? error.status : 0 } : { code: "unknown", message: String(error), status: 0 });

/** Every file under `dir` with its bytes: reading must not create or change anything. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) { out[`${path}/`] = "dir"; await walk(path); } else out[path] = `${(await stat(path)).mtimeMs}:${await readFile(path, "utf8")}`;
    }
  };
  await walk(dir);
  return out;
}

test("preamble a read prečítajú pamäť spisu klienta chatu (aj kanceláriu a VSTUPY.md) a nič nezapíšu", async () => {
  const f = await fixture();
  const before = await snapshot(f.root);
  const preamble = await readMatterMemoryForChat(f.config, f.own, { action: "preamble", matter: f.m1 }, none);
  expect(preamble).toMatchObject({ action: "preamble", matter: f.m1, complete: true, nextOffset: null, untrusted: true });
  expect(preamble.text).toContain("Necitovať");
  expect(preamble.text).toContain("Prekonaný výklad SYN");
  expect(preamble.text).not.toContain("SYN fakt 7311");
  const read = await readMatterMemoryForChat(f.config, f.own, { action: "read", matter: f.m1 }, none);
  expect(read.complete).toBe(true);
  expect(read.text).toContain("SYN fakt 7311");
  expect(read.text).toContain("SYN-IN-001");
  expect(read.text).not.toContain("SECRET");
  expect(await snapshot(f.root)).toEqual(before);
});

test("iný klient, vnorený klient a priečinok mimo klienta sa odmietnu bez čítania a bez mena klienta", async () => {
  const f = await fixture();
  for (const matter of [f.m3, f.mn, f.nested, join(f.root, "Office"), f.root, join(f.m1, "..", "..", "..", "K3-Hron", "Spisy", "M003")]) {
    for (const action of ["preamble", "read"] as const) {
      const refused = await refusal(readMatterMemoryForChat(f.config, f.own, { action, matter }, none));
      expect(refused).toMatchObject({ code: "memory_folder_not_own", status: 403 });
      expect(refused?.message).not.toMatch(/Hron|Tatran|K3|Vnoreny/);
    }
  }
  // The nested client itself reads its own case.
  expect((await readMatterMemoryForChat(f.config, f.inner, { action: "read", matter: f.mn }, none)).text).toContain("SECRET-NESTED-4401");
});

test("klient registrovaný vo vnútri iného bez vlastnej karty nedostane pamäť vonkajšieho klienta cez kartu nad spisom", async () => {
  const f = await fixture();
  const bare = join(f.k1, "Bez-karty"), case4 = join(bare, "Spisy", "M004");
  await mkdir(case4, { recursive: true });
  await memory(case4, "M-004.md", record("M-004", "matter", "L2", "Vlastný SYN", "bez karty", "SYN vlastný 6603"));
  await memory(f.k1, "C-001.md", record("C-001", "subject", "L2", "Klient K1 SYN", "údaj vonkajšieho klienta", "SECRET-OUTER-7704"));
  const inner = f.workspace("ws_bare", bare);
  const config = { ...f.config, workspaces: [...f.config.workspaces, inner] };
  // The card-less nested client's case would pull K1's client memory from K1/client.md: refused, no name.
  const refused = await refusal(readMatterMemoryForChat(config, inner, { action: "read", matter: case4 }, none));
  expect(refused).toMatchObject({ code: "memory_folder_not_own" });
  expect(refused?.message).not.toMatch(/Tatran|K1/);
  // A case registered on its own (its client folder not registered) still reads its client's memory above it.
  const alone = f.workspace("ws_case", f.m1);
  const own = await readMatterMemoryForChat({ ...f.config, workspaces: [alone, f.other] }, alone, { action: "read", matter: f.m1 }, none);
  expect(own.text).toContain("SYN fakt 7311");
});

test("pripojený priečinok klienta sa číta; po odpojení sa odmietne", async () => {
  const f = await fixture();
  const linked = join(f.root, "Zdielane", "Pripojeny-K1"), case5 = join(linked, "M005");
  await mkdir(case5, { recursive: true });
  await memory(case5, "M-005.md", record("M-005", "matter", "L2", "Pripojený SYN", "pripojený", "SYN pripojený 8805"));
  let folders: string[] = [linked];
  const links = async () => folders;
  expect((await readMatterMemoryForChat(f.config, f.own, { action: "read", matter: case5 }, links)).text).toContain("SYN pripojený 8805");
  folders = [];
  expect(await refusal(readMatterMemoryForChat(f.config, f.own, { action: "read", matter: case5 }, links))).toMatchObject({ code: "memory_folder_not_own" });
});

test("neplatné argumenty, chýbajúci priečinok a vzdialený klient", async () => {
  const f = await fixture();
  expect(await refusal(readMatterMemoryForChat(f.config, f.own, { action: "write", matter: f.m1 }, none))).toMatchObject({ code: "memory_arguments", status: 400 });
  expect(await refusal(readMatterMemoryForChat(f.config, f.own, { action: "read", matter: "Spisy/M001" }, none))).toMatchObject({ code: "memory_arguments" });
  expect(await refusal(readMatterMemoryForChat(f.config, f.own, { action: "read", matter: join(f.k1, "Spisy", "M404") }, none))).toMatchObject({ code: "memory_folder_missing", status: 404 });
  expect(await refusal(readMatterMemoryForChat(f.config, { ...f.own, workspaceType: "remote" }, { action: "read", matter: f.m1 }, none))).toMatchObject({ code: "memory_local_workspace_required" });
});

test("dlhá pamäť sa číta po stranách cez nextOffset a nič sa nestratí", async () => {
  const f = await fixture();
  const long = "SYN dlhý text ".repeat(Math.ceil(MATTER_MEMORY_PAGE / 7));
  await memory(f.m1, "M-002.md", record("M-002", "matter", "L2", "Dlhý SYN", "dlhý", `${long}KONIEC-9906`));
  const first = await readMatterMemoryForChat(f.config, f.own, { action: "read", matter: f.m1 }, none);
  expect(first.text.length).toBe(MATTER_MEMORY_PAGE);
  expect(first.nextOffset).toBe(MATTER_MEMORY_PAGE);
  let text = first.text, next = first.nextOffset;
  while (next !== null) {
    const page = await readMatterMemoryForChat(f.config, f.own, { action: "read", matter: f.m1, offset: next }, none);
    text += page.text; next = page.nextOffset;
  }
  expect(text).toContain("KONIEC-9906");
  expect(text).toContain("SYN fakt 7311");
});

test("nečitateľný záznam: complete=false a text ho pomenuje", async () => {
  const f = await fixture();
  await memory(f.m1, "M-777.md", "---\nokf: 1\nid: M-777\n---\nrozbité");
  const read = await readMatterMemoryForChat(f.config, f.own, { action: "read", matter: f.m1 }, none);
  expect(read.complete).toBe(false);
  expect(read.text).toContain("NEÚPLNÉ ČÍTANIE");
});

// Review P3a: the server reads memory in its own process. Links, pipes and huge files must not leak or block.
test("odkazy z kontextových súborov spisu a klienta na iného klienta sa nečítajú (PoC z review)", async () => {
  const f = await fixture();
  await writeFile(join(f.m3, "VSTUPY.md"), "SECRET-K3-VSTUPY\n");
  await writeFile(join(f.k3, "plan.md"), "SECRET-K3-PLAN\n");
  await writeFile(join(f.k3, "status.md"), "---\nmanual_updated: 2026-10-01\n---\n\nSECRET-K3-STATUS\n");
  await writeFile(join(f.root, "outside.txt"), "SECRET-OUTSIDE\n");
  await rm(join(f.m1, "VSTUPY.md"));
  await symlink(join(f.m3, "VSTUPY.md"), join(f.m1, "VSTUPY.md"));
  await symlink(join(f.k3, "plan.md"), join(f.m1, "KOMUNIKACNE-KANALY.md"));
  await symlink(join(f.root, "outside.txt"), join(f.k1, "VSTUPY.md"));
  await symlink(join(f.root, "outside.txt"), join(f.k1, "KOMUNIKACNE-KANALY.md"));
  await symlink(join(f.k3, "status.md"), join(f.m1, "_STATUS.md"));
  const read = await readMatterMemoryForChat(f.config, f.own, { action: "read", matter: f.m1 }, none);
  expect(read.text).not.toContain("SECRET");
  expect(read.text).toContain("SYN fakt 7311");
  expect(read.complete).toBe(false);
  expect(read.text).toContain("Symbolický odkaz nie je povolený");
});

test.skipIf(process.platform === "win32")("rúra namiesto VSTUPY.md alebo záznamu server nezablokuje", async () => {
  const f = await fixture();
  await rm(join(f.m1, "VSTUPY.md"));
  execFileSync("mkfifo", [join(f.m1, "VSTUPY.md")]);
  execFileSync("mkfifo", [join(f.m1, "memory", "M-900.md")]);
  const started = Date.now();
  const read = await readMatterMemoryForChat(f.config, f.own, { action: "read", matter: f.m1 }, none);
  expect(Date.now() - started).toBeLessThan(5000);
  expect(read.complete).toBe(false);
  expect(read.text).toContain("SYN fakt 7311");
}, 10000);

test.skipIf(process.platform === "win32")("zariadenie a príliš veľké súbory sa nečítajú celé; pamäť nad limit je neúplná", async () => {
  const f = await fixture();
  await symlink("/dev/zero", join(f.m1, "KOMUNIKACNE-KANALY.md"));
  await writeFile(join(f.m1, "memory", "M-002.md"), record("M-002", "matter", "L2", "Veľký", "veľký", "x".repeat(FILE_BYTE_LIMIT + 1)));
  const big = "y".repeat(FILE_BYTE_LIMIT - 1024);
  for (let i = 0; i <= Math.ceil(STORE_BYTE_LIMIT / big.length); i++) await memory(f.m1, `M-${300 + i}.md`, record(`M-${300 + i}`, "matter", "L2", "Diel", "diel", big));
  const first = await readMatterMemoryForChat(f.config, f.own, { action: "read", matter: f.m1 }, none);
  expect(first.complete).toBe(false);
  let text = first.text, next = first.nextOffset, pages = 1;
  while (next !== null) { const page = await readMatterMemoryForChat(f.config, f.own, { action: "read", matter: f.m1, offset: next }, none); text += page.text; next = page.nextOffset; pages++; }
  expect(text).toContain("prekračuje limit");
  expect(text).toContain("nenačítali");
  expect(text.length).toBeLessThan(STORE_BYTE_LIMIT + 2 * FILE_BYTE_LIMIT);
  expect(pages).toBeGreaterThan(1);
}, 60000);

// Re-review P3a (poc2): okf-pamat takes any `Office/` above the case; a link named Office must not read another client.
for (const where of ["case", "client"] as const) {
  test(`odkaz Office v priečinku ${where === "case" ? "prípadu" : "klienta"} na spis iného klienta sa nečíta (poc2)`, async () => {
    const f = await fixture();
    await memory(f.m3, "M-049.md", record("M-049", "matter", "L2", "Cudzí SYN", "iný klient", "SECRET-C017-OFFICE-ALIAS"));
    await symlink(f.m3, join(where === "case" ? f.m1 : f.k1, "Office"));
    for (const action of ["read", "preamble"] as const) {
      const read = await readMatterMemoryForChat(f.config, f.own, { action, matter: f.m1 }, none);
      expect(read.text).not.toContain("SECRET");
      expect(read.text).not.toMatch(/Hron|M003|K3/);
      expect(read.complete).toBe(false);
      expect(read.text).toContain("Pamäť kancelárie sa nenačítala");
    }
    // The case memory itself is still there.
    expect((await readMatterMemoryForChat(f.config, f.own, { action: "read", matter: f.m1 }, none)).text).toContain("SYN fakt 7311");
  });
}

test("Office klienta, ktorý obsahuje tohto klienta, sa nečíta; vlastné Office klienta áno", async () => {
  const f = await fixture();
  // f.inner (Vnoreny-Hron) lies inside K1: K1's own Office is another client's folder for the nested client.
  await rm(join(f.root, "Office"), { recursive: true });
  await memory(join(f.k1, "Office"), "R-001.md", record("R-001", "rule", "L1", "SECRET-OUTER-RULE", "pravidlo K1", "t"));
  const nested = await readMatterMemoryForChat(f.config, f.inner, { action: "preamble", matter: f.mn }, none);
  expect(nested.text).not.toContain("SECRET-OUTER-RULE");
  expect(nested.complete).toBe(false);
  // For K1 itself the folder is its own.
  const own = await readMatterMemoryForChat(f.config, f.own, { action: "preamble", matter: f.m1 }, none);
  expect(own.text).toContain("SECRET-OUTER-RULE");
  expect(own.complete).toBe(true);
});

// Review PR #228: a memory profile in this client's case must not map a root or a source into a nested registered client.
test("profil pamäte s koreňom alebo zdrojom vo vnorenom klientovi ho nečíta a nemenuje", async () => {
  const f = await fixture();
  await writeFile(join(f.mn, "tajne.md"), "SECRET-NESTED-PROFILE\n");
  await writeFile(join(f.m1, "_memory.md"), "SYN-MATTER-01 vlastná pamäť\n");
  await mkdir(join(f.m1, ".lawoss"), { recursive: true });
  await writeFile(join(f.m1, ".lawoss", "memory-profile.json"), JSON.stringify({
    version: 1, matterId: "SYN-MATTER-01",
    roots: [{ id: "c", path: "." }, { id: "r", path: f.nested }, { id: "k", path: f.k1 }],
    sources: [
      { id: "memory", root: "c", path: "_memory.md", role: "case_memory", required: true, writable: true, anchors: ["SYN-MATTER-01"] },
      { id: "nested", root: "r", path: "Spisy/M009/tajne.md", role: "work_note", required: true, writable: false },
      // A root this client may read (its own folder) with a source inside the nested client.
      { id: "via", root: "k", path: "Vnoreny-Hron/Spisy/M009/tajne.md", role: "work_note", required: false, writable: false },
    ],
  }));
  const read = await readMatterMemoryForChat(f.config, f.own, { action: "read", matter: f.m1 }, none);
  expect(read.text).not.toContain("SECRET");
  expect(read.text).not.toMatch(/Vnoreny|Hron/);
  expect(read.complete).toBe(false);
  expect(read.text).toContain("SYN-MATTER-01 vlastná pamäť");
});

// Review PR #228: an Office inside a container client (not its direct child) is not read by a nested client's case.
test("Office v podpriečinku klienta, ktorý obsahuje vnoreného klienta, sa nečíta", async () => {
  const f = await fixture();
  await rm(join(f.root, "Office"), { recursive: true });
  const branch = join(f.k1, "Pobocka"), deep = join(branch, "Vnoreny"), deepCase = join(deep, "Spisy", "M010");
  await mkdir(deepCase, { recursive: true });
  await writeFile(join(deep, "client.md"), "---\ntype: klient\n---\n");
  await memory(join(branch, "Office"), "R-001.md", record("R-001", "rule", "L1", "SECRET-BRANCH-RULE", "pravidlo pobočky", "t"));
  const inner = f.workspace("ws_deep", deep);
  const config = { ...f.config, workspaces: [...f.config.workspaces, inner] };
  for (const action of ["preamble", "read"] as const) {
    const read = await readMatterMemoryForChat(config, inner, { action, matter: deepCase }, none);
    expect(read.text).not.toContain("SECRET-BRANCH-RULE");
    expect(read.complete).toBe(false);
  }
});

test("s profilom praxe sa číta len kancelária praxe; iné Office nad klientom nie", async () => {
  const f = await fixture();
  const previous = process.env.LEGALWORK_RUNTIME_DB;
  const runtime = join(f.root, "..", `${f.root.split("/").pop()}-runtime`);
  cleanups.push(async () => { if (previous === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previous; await rm(runtime, { recursive: true, force: true }); });
  process.env.LEGALWORK_RUNTIME_DB = join(runtime, "runtime.sqlite");
  await mkdir(join(runtime, "lawoss-onboarding"), { recursive: true });
  await writeFile(join(runtime, "lawoss-onboarding", "profile.json"), JSON.stringify({ officeRoot: f.root }));
  // The practice office (root/Office) is read.
  expect((await readMatterMemoryForChat(f.config, f.own, { action: "preamble", matter: f.m1 }, none)).text).toContain("Prekonaný výklad SYN");
  // A practice elsewhere: the Office next to the clients is no longer the practice's, and is not read.
  await writeFile(join(runtime, "lawoss-onboarding", "profile.json"), JSON.stringify({ officeRoot: f.k3 }));
  const other = await readMatterMemoryForChat(f.config, f.own, { action: "preamble", matter: f.m1 }, none);
  expect(other.text).not.toContain("Prekonaný výklad SYN");
  expect(other.complete).toBe(false);
});
