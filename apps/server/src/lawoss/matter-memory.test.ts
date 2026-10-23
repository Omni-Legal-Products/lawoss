// LAWOSS alfa 2 (N-A3-3, MČ 23. 10. 2026): pamäť spisu sa číta bez shellu a bez karty, len v klientovi chatu
// a v jeho pripojených priečinkoch. Iný klient (aj vnorený, aj cez kartu klienta nad spisom) sa odmietne bez mena.
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { MATTER_MEMORY_PAGE, readMatterMemoryForChat } from "./matter-memory.js";

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
