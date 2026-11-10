// LAWOSS (rozhodnutia MČ 10. 11. 2026, prehliadka s vetami advokáta): A. záznam na úrovni klienta cez
// `lawoss_memory_write` (`scope: "client"`), B. lehota z pokynu advokáta jedným volaním (`kind: "instruction_deadline"`):
// riadok pokynu vo `VSTUPY.md` a úloha s `deadlines` označená „podľa pokynu advokáta, neoverené z listiny“.
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { readMatterMemoryForChat, writeMatterMemoryForChat, type MatterMemoryWritePreview, type MatterMemoryWriteResult } from "./matter-memory.js";

const D = "2026-11-10", NOW = new Date(2026, 10, 10, 9, 30, 0);
const record = (id: string, type: string, layer: string, title: string, truth: string, extra = "") =>
  `---\nokf: 1\nid: ${id}\ntype: ${type}\ntitle: ${title}\ndescription: SYN\nlayer: ${layer}\njurisdiction: sk\nstatus: active\ncreated: ${D}\nupdated: ${D}\n${extra}---\n\n## Truth\n\n${truth}\n\n## History\n\n- ${D} — založené\n`;
const NOTE = "Klient chce komunikovať len e-mailom, nie telefonicky.";
const note = (id = "CN-001") => record(id, "client_note", "L2", "Komunikácia s klientom", NOTE);
const SENTENCE = "Pri spore o úhradu dodávok máme odpovedať protistrane do 25. novembra, zapíš mi tú lehotu.";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

async function matter(dir: string, id: string, title: string) {
  await mkdir(join(dir, "memory"), { recursive: true });
  await writeFile(join(dir, "matter.md"), `---\ntitle: ${title}\njurisdiction: sk\n---\n`);
  await writeFile(join(dir, "memory", `${id}.md`), record(id, "matter", "L2", `Stav ${id}`, `SYN stav ${id}`));
}

/** Synthetic practice: Office, client K1 with three cases, a client registered inside K1, another client K3, a linked folder. */
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-memory-klient-lehota-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const office = join(root, "Office");
  await mkdir(join(office, "memory"), { recursive: true });
  const k1 = join(root, "K1-Tatran"), cases = ["M001-Spor-o-uhradu", "M002-Najom", "M003-Zmluva"].map((name) => join(k1, "Spisy", name));
  await mkdir(k1, { recursive: true });
  await writeFile(join(k1, "client.md"), "---\ntype: klient\n---\n");
  await matter(cases[0]!, "M-001", "Spor o úhradu dodávok");
  await matter(cases[1]!, "M-002", "Nájom skladu");
  await matter(cases[2]!, "M-003", "Rámcová zmluva");
  const nested = join(k1, "Vnoreny-Hron");
  await mkdir(nested, { recursive: true });
  await writeFile(join(nested, "client.md"), "---\ntype: klient\n---\n");
  const k3 = join(root, "K3-Hron"), m3 = join(k3, "Spisy", "M009");
  await mkdir(k3, { recursive: true });
  await writeFile(join(k3, "client.md"), "---\ntype: klient\n---\n");
  await matter(m3, "M-009", "Cudzí prípad");
  const linked = join(root, "Zdielane", "K1-podklady");
  await mkdir(linked, { recursive: true });
  await writeFile(join(linked, "client.md"), "---\ntype: klient\n---\n");
  const workspace = (id: string, path: string): WorkspaceInfo => ({ id, name: id, path, preset: "starter", workspaceType: "local" });
  const own = workspace("ws_k1", k1);
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture-host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: [own, workspace("ws_nested", nested), workspace("ws_k3", k3)], authorizedRoots: [k1, k3], readOnly: false, startedAt: Date.now(),
    tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const links = async () => [linked];
  const write = (body: Record<string, unknown>) => writeMatterMemoryForChat(config, own, body, links, NOW);
  return { root, office, k1, cases, nested, k3, m3, linked, own, config, links, write };
}

const refusal = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) =>
  error && typeof error === "object" && "code" in error ? { code: String(error.code), message: String("message" in error ? error.message : ""), status: "status" in error ? error.status : 0 } : { code: "unknown", message: String(error), status: 0 });

/** Every file under `dir` with its bytes. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    out[path] = entry.isDirectory() ? "dir" : entry.isSymbolicLink() ? "link" : await readFile(path, "utf8");
  }
  return out;
}

function previewOf(result: MatterMemoryWritePreview | MatterMemoryWriteResult): MatterMemoryWritePreview {
  if (result.status !== "preview") throw new Error("not a preview");
  return result;
}

test("A: poznámka pre celého klienta sa po jednom náhľade zapíše do pamäte klienta a prečíta ju každý jeho prípad", async () => {
  const f = await fixture();
  const before = await snapshot(f.root);
  const body = { matter: f.k1, record: note(), reason: "Pokyn advokáta v chate", scope: "client" };
  const preview = previewOf(await f.write(body));
  expect(preview).toMatchObject({ status: "preview", scope: "client", kind: "create", type: "client_note", title: "Komunikácia s klientom",
    target: "memory/CN-001-komunikacia-s-klientom.md", truth: NOTE });
  // The preview writes nothing.
  expect(await snapshot(f.root)).toEqual(before);
  const written = await f.write({ ...body, apply: true, approved: preview.approved });
  expect(written).toMatchObject({ status: "written", id: "CN-001", target: "memory/CN-001-komunikacia-s-klientom.md" });
  const file = join(f.k1, "memory", "CN-001-komunikacia-s-klientom.md");
  expect(await readFile(file, "utf8")).toContain(NOTE);
  // Only the client's memory folder with that one file appeared; nothing in the cases, the office or another client.
  const after = await snapshot(f.root);
  expect(Object.keys(after).filter((path) => !(path in before)).sort()).toEqual([join(f.k1, "memory"), file]);
  for (const [path, text] of Object.entries(before)) expect(after[path]).toBe(text);
  // readScope: every case of this client reads the note, completely.
  for (const dir of f.cases) {
    const read = await readMatterMemoryForChat(f.config, f.own, { action: "read", matter: dir }, f.links);
    expect(read.complete).toBe(true);
    expect(read.text).toContain(NOTE);
    expect(read.text).toContain("CN-001");
  }
  // From a case chat the same scope lands in the same client memory, and a change needs the revision and a History line.
  const second = previewOf(await f.write({ matter: f.cases[1], record: note("CN-002").replace("Komunikácia s klientom", "Fakturačný pokyn"), reason: "SYN", scope: "client" }));
  expect(second.target).toBe("memory/CN-002-fakturacny-pokyn.md");
  expect((await refusal(f.write({ ...body, record: note().replace(NOTE, "Iný text") })))?.code).toBe("memory_write_refused");
  expect(await readFile(file, "utf8")).toContain(NOTE);
});

test("A: na úrovni klienta len subject, screening a client_note vo vrstve L2; L1/L3 a ostatné typy sa odmietnu a nič sa nezapíše", async () => {
  const f = await fixture();
  const before = await snapshot(f.root);
  const client = (text: string, matterPath = f.k1) => refusal(f.write({ matter: matterPath, record: text, reason: "SYN", scope: "client" }));
  // Types of a case, and a client note with a foreign ID or an ID a case already holds.
  expect((await client(record("D-001", "decision", "L2", "Rozhodnutie", "t")))?.code).toBe("memory_write_refused");
  expect((await client(record("M-050", "matter", "L2", "Stav", "t")))?.code).toBe("memory_write_refused");
  expect((await client(record("X-001", "client_note", "L2", "Poznámka", "t")))?.message).toContain("CN-001");
  await writeFile(join(f.cases[2]!, "memory", "CN-001-ina.md"), record("CN-001", "hearing_note", "L2", "Iná", "t"));
  expect((await client(note()))?.message).toContain("already used");
  await rm(join(f.cases[2]!, "memory", "CN-001-ina.md"));
  // L1 and L3 (office rules and authorities) never through this tool, also not disguised as a client note.
  for (const text of [record("R-001", "rule", "L1", "Pravidlo", NOTE), record("L-001", "lesson", "L1", "Poučenie", NOTE),
    record("A-001", "authority", "L3", "Prameň", NOTE, "source: SYN\nverified_via: SYN\nverified_at: 2026-11-10\n"),
    record("CN-001", "client_note", "L1", "Poznámka", NOTE), record("CN-001", "client_note", "L3", "Poznámka", NOTE)]) {
    const refused = await client(text);
    expect(refused?.status).toBe(422);
  }
  // Subject and screening are the client-level types of the OKF rules.
  expect(previewOf(await f.write({ matter: f.k1, record: record("S-001", "subject", "L2", "SYN Subjekt", "t", "role: client\n"), reason: "SYN", scope: "client" })).scope).toBe("client");
  expect(previewOf(await f.write({ matter: f.k1, record: record("SC-001", "screening", "L2", "SYN Preverenie", "t"), reason: "SYN", scope: "client" })).type).toBe("screening");
  // Boundary: the office memory, a linked folder, another client (also a nested registered one), a folder outside.
  expect((await client(note(), f.office))?.status).toBe(403);
  expect((await client(note(), f.linked))?.code).toBe("memory_folder_not_own");
  expect((await client(note(), f.k3))?.code).toBe("memory_folder_not_own");
  expect((await client(note(), f.m3))?.code).toBe("memory_folder_not_own");
  expect((await client(note(), f.nested))?.code).toBe("memory_folder_not_own");
  expect((await client(note(), f.root))?.code).toBe("memory_folder_not_own");
  // An office folder inside the client, and a client memory folder that is a link elsewhere.
  const inner = join(f.k1, "Office");
  await mkdir(inner);
  await writeFile(join(inner, "client.md"), "---\ntype: klient\n---\n");
  expect((await client(note(), inner))?.code).toBe("memory_write_office");
  await rm(inner, { recursive: true });
  expect(await snapshot(f.root)).toEqual(before);
  await symlink(join(f.cases[0]!, "memory"), join(f.k1, "memory"), "dir");
  expect((await client(note()))?.code).toBe("memory_folder_not_own");
  await rm(join(f.k1, "memory"));
  // A client without its card has no client-level memory any case would read.
  await rm(join(f.k1, "client.md"));
  expect((await client(note()))?.code).toBe("memory_client_missing");
  // Without the scope the client root stays refused, as before.
  await writeFile(join(f.k1, "client.md"), "---\ntype: klient\n---\n");
  expect((await refusal(f.write({ matter: f.k1, record: note(), reason: "SYN" })))?.code).toBe("memory_write_refused");
  expect(await snapshot(f.root)).toEqual(before);
});

const deadline = (f: Awaited<ReturnType<typeof fixture>>, extra: Record<string, unknown> = {}) =>
  ({ kind: "instruction_deadline", matter: f.cases[0], date: "2026-11-25", what: "Odpoveď protistrane", instruction: SENTENCE, ...extra });

test("B: lehota z pokynu advokáta: jeden náhľad, potom riadok pokynu vo VSTUPY.md a úloha s lehotou označenou ako neoverená z listiny", async () => {
  const f = await fixture();
  const dir = f.cases[0]!, register = join(dir, "VSTUPY.md");
  const earlier = "---\ntype: input-register\n---\n\n# Vstupy\n\n| ID | Prijaté | Zdroj | Originál | Stav | Výsledné záznamy |\n|---|---|---|---|---|---|\n| IN-001 | 2026-11-01T10:00:00+01:00 | e-mail | 01_Podklady/zmluva.pdf | pending | |\n";
  await writeFile(register, earlier);
  const before = await snapshot(f.root);
  const preview = previewOf(await f.write(deadline(f)));
  expect(preview).toMatchObject({ status: "preview", kind: "create", type: "task", title: "Odpoveď protistrane",
    target: "Spisy/M001-Spor-o-uhradu/memory/T-001-odpoved-protistrane.md",
    deadline: { case: "Spor o úhradu dodávok", date: "2026-11-25", what: "Odpoveď protistrane", basis: "lawyer_instruction", register: "Spisy/M001-Spor-o-uhradu/VSTUPY.md", inputId: "IN-002" } });
  expect(preview.truth).toContain("neoverené z listiny");
  expect(await snapshot(f.root)).toEqual(before);
  // Declined = the tool never applies: nothing changed. A wrong token is refused as well.
  expect((await refusal(f.write(deadline(f, { apply: true, approved: "0".repeat(64) }))))?.code).toBe("memory_write_changed");
  expect(await snapshot(f.root)).toEqual(before);

  const written = await f.write(deadline(f, { apply: true, approved: preview.approved }));
  expect(written).toMatchObject({ status: "written", id: "T-001", register: "Spisy/M001-Spor-o-uhradu/VSTUPY.md", inputId: "IN-002" });
  // (1) The instruction's row: source = the lawyer's instruction in chat with its date, no document, closed with the record's ID.
  const rows = (await readFile(register, "utf8")).split("\n").filter((line) => line.startsWith("| IN-"));
  expect(rows[0]).toBe("| IN-001 | 2026-11-01T10:00:00+01:00 | e-mail | 01_Podklady/zmluva.pdf | pending | |");
  expect(rows[1]).toMatch(/^\| IN-002 \| 2026-11-10T09:30:00[+-]\d{2}:\d{2} \| pokyn advokáta v chate \(LAWOSS\): „Pri spore o úhradu dodávok .* zapíš mi tú lehotu\.“ \| — \| processed \| T-001 \|$/);
  expect(rows).toHaveLength(2);
  // (2) The deadline: in `deadlines` (not `due`), marked, never verified.
  const task = await readFile(join(dir, "memory", "T-001-odpoved-protistrane.md"), "utf8");
  expect(task).toContain('deadlines: ["2026-11-25 Odpoveď protistrane"]');
  expect(task).toContain("deadline_basis: lawyer_instruction");
  expect(task).toContain("type: task");
  expect(task).toContain("jurisdiction: sk");
  expect(task).not.toContain("verified");
  expect(task).not.toContain("due:");
  expect(task).toContain(`- ${D} [request] — Lehota 2026-11-25 zapísaná podľa pokynu advokáta v chate (IN-002); neoverená z listiny.`);
  // Only the two files changed.
  const after = await snapshot(f.root);
  expect(Object.keys(after).filter((path) => after[path] !== before[path]).sort()).toEqual([register, join(dir, "memory", "T-001-odpoved-protistrane.md")].sort());
  // lawoss_memory read of the case returns the deadline with its marker and the register row, completely.
  const read = await readMatterMemoryForChat(f.config, f.own, { action: "read", matter: dir }, f.links);
  expect(read.complete).toBe(true);
  expect(read.text).toContain("2026-11-25 Odpoveď protistrane");
  expect(read.text).toContain("neoverené z listiny");
  expect(read.text).toContain("| IN-002 |");
  // A second deadline gets the next IDs; a case without a register gets one.
  const next = previewOf(await f.write(deadline(f, { date: "2026-12-05", what: "Vyjadrenie k znaleckému posudku" })));
  expect(next.deadline).toMatchObject({ inputId: "IN-003" });
  expect(next.target).toContain("memory/T-002-");
  const other = previewOf(await f.write(deadline(f, { matter: f.cases[1] })));
  await f.write(deadline(f, { matter: f.cases[1], apply: true, approved: other.approved }));
  expect(await readFile(join(f.cases[1]!, "VSTUPY.md"), "utf8")).toMatch(/\| IN-001 \| .* \| — \| processed \| T-001 \|/);
});

test("B: zlyhanie druhého zápisu vráti evidenciu vstupov späť; zmena po karte sa odmietne", async () => {
  const f = await fixture();
  const dir = f.cases[0]!, register = join(dir, "VSTUPY.md");
  // The memory write fails under its lock: a register created by this call disappears again.
  const fresh = previewOf(await f.write(deadline(f)));
  await mkdir(join(dir, ".okf-write.lock"));
  const before = await snapshot(f.root);
  expect((await refusal(f.write(deadline(f, { apply: true, approved: fresh.approved }))))?.code).toBe("memory_write_refused");
  expect(await snapshot(f.root)).toEqual(before);
  expect(await stat(register).catch(() => null)).toBeNull();
  // An existing register gets its earlier bytes back.
  await rm(join(dir, ".okf-write.lock"), { recursive: true });
  const earlier = "# Vstupy\n\n| ID | Prijaté | Zdroj | Originál | Stav | Výsledné záznamy |\n|---|---|---|---|---|---|\n| IN-007 | 2026-11-01 | e-mail | a.pdf | pending | |\n";
  await writeFile(register, earlier);
  const second = previewOf(await f.write(deadline(f)));
  expect(second.deadline?.inputId).toBe("IN-008");
  await mkdir(join(dir, ".okf-write.lock"));
  expect((await refusal(f.write(deadline(f, { apply: true, approved: second.approved }))))?.code).toBe("memory_write_refused");
  expect(await readFile(register, "utf8")).toBe(earlier);
  expect((await readdir(join(dir, "memory"))).sort()).toEqual(["M-001.md"]);
  expect((await readdir(dir)).filter((name) => name.includes(".tmp-"))).toEqual([]);
  await rm(join(dir, ".okf-write.lock"), { recursive: true });
  // The register changed after the card: the approval no longer covers it.
  await writeFile(register, `${earlier}| IN-008 | 2026-11-10 | e-mail | b.pdf | pending | |\n`);
  expect((await refusal(f.write(deadline(f, { apply: true, approved: second.approved }))))?.code).toBe("memory_write_changed");
  expect((await readdir(join(dir, "memory"))).sort()).toEqual(["M-001.md"]);
});

test("B: bez výslovného dátumu, mimo prípadu, v cudzom klientovi alebo bez jurisdikcie sa nič nezapíše", async () => {
  const f = await fixture();
  const before = await snapshot(f.root);
  // The date is the lawyer's explicit calendar day: nothing derived, computed or loosely written.
  for (const date of ["", "25. novembra", "do 14 dní", "2026-11-25T10:00", "2026-02-30", "25.11.2026"]) {
    const refused = await refusal(f.write(deadline(f, { date })));
    expect(refused?.status).toBe(422);
    expect(refused?.message).toContain("Never derive or compute");
  }
  expect((await refusal(f.write({ kind: "instruction_deadline", matter: f.cases[0], what: "Odpoveď", instruction: SENTENCE })))?.code).toBe("memory_arguments");
  // Only a case of this client: not the client root, the office, a linked folder or another client.
  expect((await refusal(f.write(deadline(f, { matter: f.k1 }))))?.code).toBe("memory_write_refused");
  expect((await refusal(f.write(deadline(f, { matter: f.office }))))?.status).toBe(403);
  expect((await refusal(f.write(deadline(f, { matter: f.linked }))))?.code).toBe("memory_folder_not_own");
  expect((await refusal(f.write(deadline(f, { matter: f.m3 }))))?.code).toBe("memory_folder_not_own");
  // The jurisdiction is never assumed.
  const bare = join(f.k1, "Spisy", "M004-Bez-jurisdikcie");
  await mkdir(bare, { recursive: true });
  await writeFile(join(bare, "matter.md"), "---\ntitle: Bez jurisdikcie\n---\n");
  expect((await refusal(f.write(deadline(f, { matter: bare }))))?.message).toContain("jurisdiction");
  await rm(bare, { recursive: true });
  // A read-only server writes nothing.
  expect((await refusal(writeMatterMemoryForChat({ ...f.config, readOnly: true }, f.own, deadline(f), f.links, NOW)))?.code).toBe("read_only");
  expect(await snapshot(f.root)).toEqual(before);
});
