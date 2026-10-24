/**
 * Review P3a (23. 10. 2026): `read`/`preamble` číta pamäť aj v serveri aplikácie. Súbor v spise nesmie
 * viesť inam (odkaz na spis iného klienta), zablokovať čítanie (rúra) ani vyčerpať pamäť (zariadenie,
 * obrovský súbor). Taký súbor sa nečíta a výstup ho ohlási ako nečitateľný (kód 1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.ts";
import { FILE_BYTE_LIMIT, STORE_BYTE_LIMIT, STORE_FILE_LIMIT } from "../src/safe-read.ts";
import { readWorkspaceMemory, renderWorkspaceMemory } from "../src/workspace-memory.ts";

const D = "2026-10-23";
const record = (id: string, truth: string) =>
  `---\nokf: 1\nid: ${id}\ntype: matter\ntitle: Stav ${id}\ndescription: SYN\nlayer: L2\njurisdiction: sk\nstatus: active\ncreated: ${D}\nupdated: ${D}\n---\n\n## Truth\n\n${truth}\n\n## History\n\n- ${D} — založené\n`;

/** K1 s prípadom M001 (vlastný fakt) a K3 s tajomstvami, ktoré sa do výstupu K1 nesmú dostať. */
function fixture() {
  // The temporary root deliberately contains "K3": name checks look only below the root (random mkdtemp
  // suffixes can contain it, CI 24. 10. 2026).
  // Native realpath like the reader: on Windows plain realpathSync keeps 8.3 names (RUNNER~1), the reader prints long ones.
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "okf-safe-read-K3-")));
  const k1 = join(root, "K1"), m1 = join(k1, "Spisy", "M001"), k3 = join(root, "K3"), m3 = join(k3, "Spisy", "M003");
  mkdirSync(join(m1, "memory"), { recursive: true }); mkdirSync(m3, { recursive: true });
  writeFileSync(join(k1, "client.md"), "---\ntype: klient\n---\n");
  writeFileSync(join(k3, "client.md"), "---\ntype: klient\n---\n");
  writeFileSync(join(m1, "memory", "M-001.md"), record("M-001", "SYN vlastný 1101"));
  writeFileSync(join(m3, "VSTUPY.md"), "SECRET-K3-VSTUPY\n");
  writeFileSync(join(k3, "plan.md"), "SECRET-K3-PLAN\n");
  writeFileSync(join(k3, "status.md"), "---\nmanual_updated: 2026-10-01\n---\n\nSECRET-K3-STATUS\n");
  writeFileSync(join(root, "outside.txt"), "SECRET-OUTSIDE\n");
  return { root, k1, m1, k3, m3 };
}

test("odkazy z kontextových súborov spisu a klienta sa nečítajú (PoC z review)", () => {
  const f = fixture();
  symlinkSync(join(f.m3, "VSTUPY.md"), join(f.m1, "VSTUPY.md"));
  symlinkSync(join(f.k3, "plan.md"), join(f.m1, "KOMUNIKACNE-KANALY.md"));
  symlinkSync(join(f.root, "outside.txt"), join(f.k1, "VSTUPY.md"));
  symlinkSync(join(f.root, "outside.txt"), join(f.k1, "KOMUNIKACNE-KANALY.md"));
  symlinkSync(join(f.k3, "status.md"), join(f.m1, "_STATUS.md"));
  const r = runCli(["read", f.m1]);
  assert.doesNotMatch(r.out, /SECRET/);
  assert.match(r.out, /SYN vlastný 1101/);
  assert.equal(r.code, 1);
  assert.match(r.out, /NEÚPLNÉ ČÍTANIE/);
  assert.match(r.out, /Symbolický odkaz nie je povolený/);
});

test("odkaz na kartu veci sa nečíta", () => {
  const f = fixture();
  writeFileSync(join(f.k3, "spis.md"), "---\njurisdiction: cz\n---\nSECRET-CARD\n");
  symlinkSync(join(f.k3, "spis.md"), join(f.m1, "spis.md"));
  // Bez záznamov sa jurisdikcia berie z karty veci.
  unlinkSync(join(f.m1, "memory", "M-001.md"));
  const r = runCli(["read", f.m1]);
  assert.doesNotMatch(r.out, /SECRET/);
  assert.equal(r.code, 1);
  assert.match(r.out, /Symbolický odkaz nie je povolený: .*spis\.md/);
});

test("rúra namiesto VSTUPY.md čítanie nezablokuje", { skip: process.platform === "win32" }, () => {
  const f = fixture();
  execFileSync("mkfifo", [join(f.m1, "VSTUPY.md")]);
  execFileSync("mkfifo", [join(f.m1, "memory", "M-900.md")]);
  const started = Date.now();
  const r = runCli(["read", f.m1]);
  assert.ok(Date.now() - started < 5000);
  assert.equal(r.code, 1);
  assert.match(r.out, /Nie je bežný súbor|musí byť bežný súbor/);
  assert.match(r.out, /SYN vlastný 1101/);
});

test("odkaz na zariadenie a príliš veľký súbor sa nečítajú celé", { skip: process.platform === "win32" }, () => {
  const f = fixture();
  symlinkSync("/dev/zero", join(f.m1, "KOMUNIKACNE-KANALY.md"));
  writeFileSync(join(f.m1, "VSTUPY.md"), Buffer.alloc(FILE_BYTE_LIMIT + 1, 0x61));
  writeFileSync(join(f.m1, "memory", "M-002.md"), record("M-002", "x".repeat(FILE_BYTE_LIMIT + 1)));
  const r = runCli(["read", f.m1]);
  assert.equal(r.code, 1);
  assert.match(r.out, /prekračuje limit/);
  assert.ok(r.out.length < FILE_BYTE_LIMIT, `output ${r.out.length} bytes`);
});

test("pamäť nad celkový limit sa číta neúplne, nie celá", () => {
  const f = fixture();
  const chunk = "y".repeat(FILE_BYTE_LIMIT - 1024);
  const count = Math.ceil(STORE_BYTE_LIMIT / chunk.length) + 1;
  for (let i = 0; i < count; i++) writeFileSync(join(f.m1, "memory", `M-${String(100 + i)}.md`), record(`M-${100 + i}`, chunk));
  const r = runCli(["read", f.m1]);
  assert.equal(r.code, 1);
  assert.match(r.out, /nenačítali/);
  assert.ok(r.out.length < STORE_BYTE_LIMIT + FILE_BYTE_LIMIT * 2, `output ${r.out.length} bytes`);
});

test("okf.config ako odkaz na zariadenie: čítanie skončí s chybou konfigu, nezasekne sa", { skip: process.platform === "win32" }, () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "okf-safe-config-")));
  const matter = join(root, "K", "Spisy", "M");
  mkdirSync(join(matter, "memory"), { recursive: true });
  mkdirSync(join(root, "Office"));
  symlinkSync("/dev/zero", join(root, "Office", "okf.config"));
  for (const command of ["read", "preamble"]) {
    const r = runCli([command, matter]);
    assert.equal(r.code, 1);
    assert.match(r.out, /okf\.config: súbor sa nedá prečítať — Symbolický odkaz nie je povolený/);
  }
});

test("hostiteľ s office:false kanceláriu nečíta a čítanie je neúplné; CLI bez voľby ju číta ako doteraz", () => {
  const f = fixture();
  writeFileSync(join(f.m3, "VSTUPY.md"), "x\n");
  mkdirSync(join(f.m3, "memory"), { recursive: true });
  writeFileSync(join(f.m3, "memory", "M-049.md"), record("M-049", "SECRET-C017-OFFICE-ALIAS"));
  symlinkSync(f.m3, join(f.m1, "Office"));
  for (const command of ["read", "preamble"]) {
    const host = runCli([command, f.m1], { office: false });
    assert.equal(host.code, 1);
    assert.doesNotMatch(host.out, /SECRET/);
    assert.match(host.out, /Pamäť kancelárie sa nenačítala/);
  }
  // The portable CLI in the lawyer's own shell keeps its behavior (the shell can read the folder anyway).
  assert.match(runCli(["read", f.m1]).out, /SECRET-C017-OFFICE-ALIAS/);
});

test("hostiteľ s excludedRoots nečíta koreň ani zdroj profilu v cudzom priečinku a nemenuje ho", () => {
  const f = fixture();
  writeFileSync(join(f.m3, "tajne.md"), "SECRET-PROFILE-K3\n");
  writeFileSync(join(f.m1, "_memory.md"), "SYN-01 pamäť\n");
  mkdirSync(join(f.m1, ".lawoss"));
  writeFileSync(join(f.m1, ".lawoss", "memory-profile.json"), JSON.stringify({ version: 1, matterId: "SYN-01",
    roots: [{ id: "c", path: "." }, { id: "x", path: f.k3 }, { id: "p", path: f.root }],
    sources: [
      { id: "memory", root: "c", path: "_memory.md", role: "case_memory", required: true, writable: true, anchors: ["SYN-01"] },
      { id: "foreign", root: "x", path: "Spisy/M003/tajne.md", role: "work_note", required: true, writable: false },
      { id: "via", root: "p", path: "K3/Spisy/M003/tajne.md", role: "work_note", required: false, writable: false },
    ] }));
  const report = readWorkspaceMemory(f.m1, { allowedRoots: [f.root], excludedRoots: [f.k3] });
  const text = renderWorkspaceMemory(report);
  assert.equal(report.complete, false);
  assert.doesNotMatch(text.split(f.root).join("<root>"), /SECRET|K3/);
  assert.ok(!text.includes(f.k3));
  assert.match(text, /SYN-01 pamäť/);
  // Without the host exclusion the portable CLI reads what its grants allow, as before.
  assert.match(renderWorkspaceMemory(readWorkspaceMemory(f.m1, { allowedRoots: [f.root] })), /SECRET-PROFILE-K3/);
});

test("pamäť s viac ako STORE_FILE_LIMIT súbormi sa číta neúplne", () => {
  const f = fixture();
  for (let i = 0; i <= STORE_FILE_LIMIT; i++) writeFileSync(join(f.m1, "memory", `X-${String(i).padStart(5, "0")}.md`), "");
  const started = Date.now();
  const r = runCli(["read", f.m1]);
  assert.equal(r.code, 1);
  assert.match(r.out, new RegExp(`viac ako ${STORE_FILE_LIMIT} položiek`));
  assert.ok(r.out.split("\n").length < STORE_FILE_LIMIT + 200, `${r.out.split("\n").length} lines`);
  assert.ok(Date.now() - started < 10000);
});
