/**
 * Texty z Windows: `okf.config`, návrh záznamu, `_STATUS.md`, karta veci aj JSON
 * požiadavka uložené „UTF-8 s BOM“ alebo v UTF-16 (PowerShell 5.1, Poznámkový blok).
 *
 * Kódovanie sa simuluje bajtmi, takže testy bežia všade. Testy s `powershell.exe`
 * overujú, že PowerShell 5.1 tie bajty naozaj tak zapíše — tie bežia iba na Windows.
 */

import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/cli.ts";
import { serializeRecord } from "../src/record.ts";
import { readManualStatus } from "../src/manual-status.ts";
import { statusSkeleton } from "../src/render.ts";
import { decodeText, stripBom } from "../src/text-decode.ts";
import { inspectStandingAuthorization, readClientPath, readConfiguredLawyerName } from "../src/config.ts";
import { jurisdictionFromCard } from "../src/store.ts";
import {
  newRecord, planWrite, applyRecordWrite, readStandingAuthorization, readNameLeakSeverity, documentLanguageFromCard,
  readWorkspaceMemory, MEMORY_DIR, OFFICE_DIR, CONFIG_FILE, LeakBlockedError, type WorkspaceMemoryReport,
} from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";
import { hasWindowsPowerShell, psQuote, runWindowsPowerShell, writeWithWindowsPowerShell } from "../../tests/windows-powershell.mts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const temp = (prefix: string): string => { const root = realpathSync(mkdtempSync(join(tmpdir(), prefix))); roots.push(root); return root; };

const KODOVANIA: Record<string, (text: string) => Buffer> = {
  "UTF-8 s BOM": (text) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]),
  "UTF-16LE s BOM": (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]),
  "UTF-16BE s BOM": (text) => Buffer.from(`﻿${text}`, "utf16le").swap16(),
};

/** Poverenie tak, ako ho advokát napíše v Poznámkovom bloku: CRLF a diakritika. */
const POVERENIE = [
  "standing_authorization: JUDr. Vojtěch Říha, Ph.D.",
  "granted_at: 2026-09-02",
  "expires_at: 2099-12-31",
  "scope: [L1, L3]",
  "reason: agentné vedenie spisov",
  "leak_name_severity: warning",
  "leak_name_reason: verejné mená v judikatúre",
  "client_path: AK/*",
];
const CRLF = POVERENIE.join("\r\n") + "\r\n";

/** Kancelária → klient → spis, karta klienta je prítomná. */
function kancelaria(config: Buffer | string): { root: string; office: string; spis: string } {
  const root = temp("okf-win-kod-");
  const spis = join(root, "Novák Jan", "2026-09 vec");
  mkdirSync(join(spis, MEMORY_DIR), { recursive: true });
  mkdirSync(join(root, "Novák Jan", MEMORY_DIR), { recursive: true });
  writeFileSync(join(root, "Novák Jan", "klient.md"), "---\ntype: klient\n---\n");
  const office = join(root, OFFICE_DIR);
  mkdirSync(join(office, MEMORY_DIR), { recursive: true });
  writeFileSync(join(office, CONFIG_FILE), config);
  writeFileSync(join(spis, "_STATUS.md"), "# Status\n");
  return { root, office, spis };
}

function poucenie(): OkfRecord {
  return newRecord({
    id: "L-001", type: "lesson", jurisdiction: "cz",
    title: "Príslušnosť overovať pred podaním", description: "poučenie do praxe",
    created: "2026-09-02", updated: "2026-09-02", truth: "Overiť sídlo pred podaním.",
    timeline: [{ date: "2026-09-02", text: "vzniklo z veci" }],
  });
}

function navrh(dir: string, content: string | Buffer): string {
  const path = join(dir, "navrh.md");
  writeFileSync(path, content);
  return path;
}

const pocet = (dir: string): number => readdirSync(join(dir, MEMORY_DIR)).filter((f) => f.endsWith(".md")).length;

// --- dekodér ----------------------------------------------------------------

test("decodeText: UTF-8 bez BOM aj s BOM, UTF-16LE a UTF-16BE s BOM dajú ten istý text", () => {
  const text = "standing_authorization: JUDr. Vojtěch Říha 𝐀\r\nreason: ľščťžýáíé\r\n";
  assert.equal(decodeText(Buffer.from(text, "utf8")), text);
  for (const [name, encode] of Object.entries(KODOVANIA)) assert.equal(decodeText(encode(text)), text, name);
});

test("decodeText: bez BOM sa UTF-16 neháda a neplatné UTF-8 dopadne ako pri readFileSync", () => {
  const invalid = Buffer.from([0x61, 0xc3, 0x28, 0x62, 0xff]);
  assert.equal(decodeText(invalid), invalid.toString("utf8"));
  assert.throws(() => decodeText(invalid, true));
  assert.equal(decodeText(Buffer.from("ab", "utf16le")), "a\u0000b\u0000");
  assert.equal(decodeText(new Uint8Array()), "");
  assert.equal(stripBom("﻿---"), "---");
  assert.equal(stripBom("---﻿"), "---﻿");
});

// --- okf.config -------------------------------------------------------------

for (const [name, encode] of Object.entries(KODOVANIA)) {
  test(`okf.config v ${name}: knižnica prečíta poverenie, prah mien aj vzor klienta`, () => {
    const { office } = kancelaria(encode(CRLF));
    const auth = readStandingAuthorization(office);
    assert.equal(auth?.by, "JUDr. Vojtěch Říha, Ph.D.");
    assert.deepEqual(auth?.scope, ["L1", "L3"]);
    assert.equal(inspectStandingAuthorization(office).problem, undefined);
    assert.equal(readNameLeakSeverity(office), "warning");
    assert.equal(readClientPath(office), "AK/*");
    assert.equal(readConfiguredLawyerName(office), "JUDr. Vojtěch Říha, Ph.D.");
  });

  test(`okf.config v ${name}: validate je čistý a write prejde na trvalé poverenie`, () => {
    const { root, spis } = kancelaria(encode(CRLF));
    const validate = runCli(["validate", spis]);
    assert.equal(validate.code, 0, validate.out);
    assert.doesNotMatch(validate.out, /STANDING_AUTH/);
    const write = runCli(["write", spis, "--file", navrh(spis, serializeRecord(poucenie())), "--reason", "z veci", "--apply"]);
    assert.equal(write.code, 0, write.out);
    assert.match(write.out, /trvalé poverenie do 2099-12-31/);
    assert.equal(pocet(join(root, OFFICE_DIR)), 1);
  });
}

test("nečitateľný okf.config: validate hlási STANDING_AUTH_INVALID, write chce --approve-as, nič nespadne", () => {
  const { root, office, spis } = kancelaria(`${CRLF}Toto je poznámka bez dvojbodky\r\n`);
  assert.match(inspectStandingAuthorization(office).problem ?? "", /nedá prečítať/);
  assert.equal(readStandingAuthorization(office), undefined);
  // Zmäkčenie zhody mien sa z nečitateľného konfigu neudelí.
  assert.equal(readNameLeakSeverity(office), "error");
  const validate = runCli(["validate", spis]);
  assert.equal(validate.code, 0, validate.out);
  assert.match(validate.out, /WARNING STANDING_AUTH_INVALID Office\/okf\.config: súbor sa nedá prečítať/);
  const file = navrh(spis, serializeRecord(poucenie()));
  const blocked = runCli(["write", spis, "--file", file, "--reason", "z veci", "--apply"]);
  assert.equal(blocked.code, 1, blocked.out);
  assert.match(blocked.out, /--approve-as/);
  assert.equal(pocet(join(root, OFFICE_DIR)), 0);
  const approved = runCli(["write", spis, "--file", file, "--reason", "z veci", "--apply", "--approve-as", "Test Advokát"]);
  assert.equal(approved.code, 0, approved.out);
});

test("okf.config v ANSI (Set-Content bez -Encoding) poverenie nedá: meno v podpise by bolo poškodené", () => {
  // Windows-1250: „ě“ = 0xEC, „Ř“ = 0xD8, „í“ = 0xED — v UTF-8 neplatné bajty.
  const { office, spis } = kancelaria(Buffer.from(CRLF.replace("Vojtěch Říha", "Vojt\u00ECch \u00D8\u00EDha"), "latin1"));
  assert.match(inspectStandingAuthorization(office).problem ?? "", /nie je v UTF-8 ani v UTF-16/);
  assert.equal(readConfiguredLawyerName(office), undefined);
  const validate = runCli(["validate", spis]);
  assert.equal(validate.code, 0, validate.out);
  assert.match(validate.out, /STANDING_AUTH_INVALID.*ulož ho ako UTF-8/);
  assert.equal(runCli(["write", spis, "--file", navrh(spis, serializeRecord(poucenie())), "--reason", "z veci", "--apply"]).code, 1);
});

test("nečitateľný okf.config so vzorom klienta je nečitateľný súbor v dosahu, nie spis bez klienta", () => {
  const root = temp("okf-win-kod-");
  const spis = join(root, "AK", "Novák Jan", "vec");
  mkdirSync(join(spis, MEMORY_DIR), { recursive: true });
  mkdirSync(join(root, OFFICE_DIR, MEMORY_DIR), { recursive: true });
  const config = join(root, OFFICE_DIR, CONFIG_FILE);
  writeFileSync(config, "client_path: AK/*\n  odsadené bez kľúča\n");
  writeFileSync(join(spis, "_STATUS.md"), "# Status\n");
  for (const cmd of ["read", "validate", "sync"]) {
    const result = runCli(cmd === "sync" ? [cmd, spis, "--apply"] : [cmd, spis]);
    assert.equal(result.code, 1, `${cmd}: ${result.out}`);
    assert.match(result.out, /NEÚPLNÉ ČÍTANIE/, cmd);
    assert.ok(result.out.includes(config), cmd);
  }
  const pramen = newRecord({
    id: "A-001", type: "authority", jurisdiction: "cz", title: "Právna veta", description: "prameň",
    created: "2026-09-02", updated: "2026-09-02", truth: "Veta.", timeline: [{ date: "2026-09-02", text: "z" }],
  });
  // Bez klientskej úrovne by brána úniku nemala jehly klienta — zápis do L3 preto neprejde.
  assert.throws(() => applyRecordWrite(spis, planWrite(undefined, pramen, "veta"), { by: "Test Advokát", at: "2026-10-05T10:00:00Z" }), LeakBlockedError);
});

// --- _STATUS.md -------------------------------------------------------------

const STATUS = "---\r\ntype: status\r\nmanual_updated: 2026-09-01\r\n---\r\n\r\n# Status\r\n\r\n> **Fáza:** Čakáme na súd.\r\n";
/** Kostra s markermi, ktorú advokát doplnil v Poznámkovom bloku. */
const STATUS_S_BLOKMI = statusSkeleton("sk").replace('manual_updated: ""', "manual_updated: 2026-09-01")
  .replace("> **Fáza:**", "> **Fáza:** Čakáme na súd.").replace(/\n/g, "\r\n");

test("readManualStatus: _STATUS.md s BOM (LF aj CRLF) nestratí manual_updated", () => {
  for (const text of [STATUS, STATUS.replace(/\r\n/g, "\n")]) {
    const status = readManualStatus(`﻿${text}`, [], "2026-10-05");
    assert.equal(status.state, "dated");
    assert.equal(status.updated, "2026-09-01");
    assert.match(status.content, /Čakáme na súd\./);
  }
});

for (const [name, encode] of Object.entries(KODOVANIA)) {
  test(`_STATUS.md v ${name}: read ukáže deklarovaný dátum a sync ho neprepíše na zmes kódovaní`, () => {
    const dir = temp("okf-win-status-");
    mkdirSync(join(dir, MEMORY_DIR));
    writeFileSync(join(dir, "matter.md"), "---\ntype: matter\njurisdiction: sk\n---\n");
    writeFileSync(join(dir, "_STATUS.md"), encode(STATUS_S_BLOKMI));
    writeFileSync(join(dir, MEMORY_DIR, "R-001.md"), serializeRecord(newRecord({
      id: "R-001", type: "decision", jurisdiction: "sk", title: "Rozhodnutie", description: "syntetické",
      created: "2026-08-02", updated: "2026-08-02", truth: "Fakt", timeline: [{ date: "2026-08-02", text: "Vzniklo" }],
    })));
    const before = runCli(["read", dir]);
    assert.equal(before.code, 0, before.out);
    assert.match(before.out, /deklarovaný dátum 2026-09-01/);
    assert.match(before.out, /Čakáme na súd\./);
    const sync = runCli(["sync", dir, "--apply"]);
    assert.equal(sync.code, 0, sync.out);
    const bytes = readFileSync(join(dir, "_STATUS.md"));
    assert.equal(bytes.includes(0), false, "projekcia sa zapisuje ako UTF-8");
    const after = bytes.toString("utf8");
    assert.doesNotMatch(after, /�/);
    assert.match(after, /manual_updated: 2026-09-01/);
    assert.match(after, /Čakáme na súd\./);
    assert.match(after, /\[R-001\]\(\.\/memory\/R-001\.md\)/);
    assert.match(runCli(["read", dir]).out, /deklarovaný dátum 2026-09-01/);
  });
}

// --- návrh záznamu a karta veci -----------------------------------------------

for (const [name, encode] of Object.entries(KODOVANIA)) {
  test(`návrh záznamu (--file) v ${name} sa zapíše`, () => {
    const dir = temp("okf-win-navrh-");
    mkdirSync(join(dir, MEMORY_DIR));
    const record = newRecord({
      id: "F-001", type: "fact", jurisdiction: "cz", title: "Doručenie žaloby", description: "syntetické",
      created: "2026-09-02", updated: "2026-09-02", truth: "Žaloba bola doručená.", timeline: [{ date: "2026-09-02", text: "Vzniklo" }],
    });
    const file = join(temp("okf-win-tmp-"), "navrh.md");
    writeFileSync(file, encode(serializeRecord(record).replace(/\n/g, "\r\n")));
    const result = runCli(["write", dir, "--file", file, "--reason", "z podania", "--apply"]);
    assert.equal(result.code, 0, result.out);
    assert.equal(pocet(dir), 1);
    assert.match(runCli(["read", dir]).out, /Žaloba bola doručená\./);
  });

  test(`karta veci v ${name}: jazyk dokumentov aj jurisdikcia sa prečítajú`, () => {
    const dir = temp("okf-win-karta-");
    writeFileSync(join(dir, "matter.md"), encode("---\r\ntype: matter\r\njurisdiction: cz\r\nlanguage: cs\r\n---\r\n# Věc\r\n"));
    assert.equal(documentLanguageFromCard(dir), "cs");
    assert.equal(jurisdictionFromCard(dir), "cz");
  });
}

// --- workspace profil a JSON požiadavka ---------------------------------------

function workspace(): { root: string; request: (report: WorkspaceMemoryReport) => string } {
  const root = temp("okf-win-ws-");
  mkdirSync(join(root, ".lawoss"));
  const profile = {
    version: 1, matterId: "synthetic-01", roots: [{ id: "matter", path: "." }],
    sources: [{ id: "memory", root: "matter", path: "_memory.md", role: "case_memory", required: true, writable: true, anchors: ["SYNTHETIC-01"] }],
  };
  writeFileSync(join(root, ".lawoss", "memory-profile.json"), KODOVANIA["UTF-8 s BOM"]!(JSON.stringify(profile, null, 2)));
  writeFileSync(join(root, "_memory.md"), "SYNTHETIC-01 pamäť\n");
  return {
    root,
    request: (report) => JSON.stringify({
      version: 1, matterId: report.matterId, operationId: "op-windows", reason: "Synthetic update",
      expectedBindingHash: report.bindingHash, expectedContextHash: report.contextHash,
      updates: report.sources.map((s) => ({ sourceId: s.id, expectedSha256: s.sha256, content: `${s.content}nová práca\n` })),
    }, null, 2),
  };
}

test("memory-profile.json s BOM: workspace-read je úplný", () => {
  const { root } = workspace();
  const report = readWorkspaceMemory(root);
  assert.equal(report.complete, true, JSON.stringify(report.problems));
});

for (const [name, encode] of Object.entries(KODOVANIA)) {
  test(`JSON snapshot a request.json v ${name}: snapshot sa dá prečítať a workspace-save ho prijme`, () => {
    const { root, request } = workspace();
    const read = runCli(["workspace-read", root, "--json"]);
    assert.equal(read.code, 0, read.out);
    // Ako `--json > snapshot.json` v PowerShelli 5.1: ten istý report, iné bajty.
    const snapshotFile = join(root, "snapshot.json");
    writeFileSync(snapshotFile, encode(read.out));
    const snapshot = JSON.parse(decodeText(readFileSync(snapshotFile))) as WorkspaceMemoryReport;
    assert.deepEqual(snapshot, JSON.parse(read.out));
    const file = join(root, "request.json");
    writeFileSync(file, encode(request(snapshot)));
    const save = runCli(["workspace-save", root, "--file", file, "--json"]);
    assert.equal(save.code, 0, save.out);
    assert.equal(JSON.parse(save.out).status, "preview");
  });
}

// --- zbalené CLI ------------------------------------------------------------

test("zbalené okf-memory.js prečíta okf.config v UTF-16LE", () => {
  const { spis } = kancelaria(KODOVANIA["UTF-16LE s BOM"]!(CRLF));
  const bundle = fileURLToPath(new URL("../bundle/okf-memory.js", import.meta.url));
  const result = spawnSync(process.execPath, [bundle, "validate", spis], { encoding: "utf8" });
  assert.equal(result.stderr, "");
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /OK — pamäť je konzistentná/);
});

// --- skutočný Windows PowerShell 5.1 -----------------------------------------

test("Windows PowerShell 5.1: okf.config cez Set-Content -Encoding UTF8, Out-File aj > platí", { skip: !hasWindowsPowerShell }, () => {
  for (const [how, bom] of [["Set-Content -Encoding UTF8", [0xef, 0xbb, 0xbf]], ["Out-File", [0xff, 0xfe]], [">", [0xff, 0xfe]]] as const) {
    const { root, office, spis } = kancelaria("");
    const bytes = writeWithWindowsPowerShell(join(office, CONFIG_FILE), POVERENIE, how);
    assert.deepEqual([...bytes.subarray(0, bom.length)], [...bom], `${how} zapísal iné kódovanie, než predpokladá decodeText`);
    assert.equal(readStandingAuthorization(office)?.by, "JUDr. Vojtěch Říha, Ph.D.", how);
    const validate = runCli(["validate", spis]);
    assert.equal(validate.code, 0, `${how}: ${validate.out}`);
    assert.doesNotMatch(validate.out, /STANDING_AUTH/);
    const write = runCli(["write", spis, "--file", navrh(spis, serializeRecord(poucenie())), "--reason", "z veci", "--apply"]);
    assert.equal(write.code, 0, `${how}: ${write.out}`);
    assert.equal(pocet(join(root, OFFICE_DIR)), 1);
  }
  // `Set-Content` bez -Encoding píše ANSI: diakritika v mene sa nesmie dostať do podpisu poškodená.
  const { office } = kancelaria("");
  writeWithWindowsPowerShell(join(office, CONFIG_FILE), POVERENIE, "Set-Content");
  assert.match(inspectStandingAuthorization(office).problem ?? "", /nie je v UTF-8 ani v UTF-16/);
});

test("Windows PowerShell 5.1: `workspace-read --json > snapshot.json` a request.json cez > prejdú", { skip: !hasWindowsPowerShell }, () => {
  const { root, request } = workspace();
  const cli = fileURLToPath(new URL("../bin/okf-memory.ts", import.meta.url));
  const snapshotFile = join(root, "snapshot.json");
  runWindowsPowerShell(`& ${psQuote(process.execPath)} ${psQuote(cli)} workspace-read ${psQuote(root)} --json > ${psQuote(snapshotFile)}`);
  const bytes = readFileSync(snapshotFile);
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe], "PowerShell 5.1 má pri > zapísať UTF-16LE");
  const snapshot = JSON.parse(decodeText(bytes)) as WorkspaceMemoryReport;
  assert.equal(snapshot.complete, true, JSON.stringify(snapshot.problems));
  const utf8 = join(root, "request-utf8.json"), file = join(root, "request.json");
  writeFileSync(utf8, request(snapshot));
  runWindowsPowerShell(`Get-Content -Raw -Encoding UTF8 -LiteralPath ${psQuote(utf8)} > ${psQuote(file)}`);
  assert.deepEqual([...readFileSync(file).subarray(0, 2)], [0xff, 0xfe]);
  const save = runCli(["workspace-save", root, "--file", file, "--json"]);
  assert.equal(save.code, 0, save.out);
  assert.equal(JSON.parse(save.out).status, "preview");
});
