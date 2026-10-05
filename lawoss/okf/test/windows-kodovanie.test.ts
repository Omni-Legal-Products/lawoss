import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "../src/core.ts";
import { plan } from "../src/fs.ts";
import { hasWindowsPowerShell, WINDOWS_POWERSHELL_TIMEOUT_MS, writeWithWindowsPowerShell } from "../../tests/windows-powershell.mts";

// Kancelársky profil v okf.config z Poznámkového bloku alebo PowerShellu 5.1 (BOM, UTF-16, CRLF)
// musí nový spis dostať rovnako ako okf-memory; inak onboarding spadne na prvom riadku.
let root = "";
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), "okf-win-kod-"))); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const CONFIG = [
  "standing_authorization: Ján Novák",
  'matter_folders: ["Podklady", "Drafty"]',
  "folder_roles:",
  "  drafts: Drafty",
  'document_naming: "{date}_{description}"',
];
const ENCODINGS: Record<string, (text: string) => Buffer> = {
  "UTF-8 with BOM": (text) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]),
  "UTF-16LE with BOM": (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]),
  "UTF-16BE with BOM": (text) => Buffer.from(`﻿${text}`, "utf16le").swap16(),
};

function expectOfficeProfile(dir: string) {
  const p = plan({ type: "spis", dir, title: "Synthetic", jurisdiction: "sk" });
  expect(p.entries.some((entry) => entry.path === "Drafty/.keep")).toBe(true);
  expect(p.entries.some((entry) => entry.path === "03_Drafty/.keep")).toBe(false);
  expect(p.entries.find((entry) => entry.path === "PRACOVNY-PROFIL.md")?.content).toContain("{date}_{description}");
  expect(parseFrontmatter(p.entries.find((entry) => entry.path === "matter.md")?.content ?? "")?.advokat).toBe("Ján Novák");
}

for (const [name, encode] of Object.entries(ENCODINGS)) {
  test(`office okf.config in ${name} with CRLF drives the new matter plan`, () => {
    mkdirSync(join(root, "Office"));
    writeFileSync(join(root, "Office", "okf.config"), encode(CONFIG.join("\r\n") + "\r\n"));
    expectOfficeProfile(join(root, "client", "matter"));
  });
}

test("an ANSI byte only in a comment of okf.config keeps the office profile and the lawyer name", () => {
  mkdirSync(join(root, "Office"));
  writeFileSync(join(root, "Office", "okf.config"), Buffer.concat([
    Buffer.from(CONFIG.join("\r\n") + "\r\n", "utf8"),
    Buffer.from("# poznámka kancelárie\r\n", "latin1"),
  ]));
  expectOfficeProfile(join(root, "client", "matter"));
});

test("an ANSI lawyer name is not prefilled damaged; the rest of the office profile still applies", () => {
  mkdirSync(join(root, "Office"));
  writeFileSync(join(root, "Office", "okf.config"), Buffer.from(CONFIG.join("\r\n") + "\r\n", "latin1"));
  const p = plan({ type: "spis", dir: join(root, "client", "matter"), title: "Synthetic", jurisdiction: "sk" });
  expect(p.entries.some((entry) => entry.path === "Drafty/.keep")).toBe(true);
  const card = p.entries.find((entry) => entry.path === "matter.md")?.content ?? "";
  expect(card).not.toContain("\uFFFD");
  // Bez mena ostáva v karte zástupný text, nie „J\uFFFDn Novák“.
  expect(parseFrontmatter(card)?.advokat).toBe("[DOPLNIT]");
});

test("bundled okf.js reads a UTF-16LE office okf.config", () => {
  mkdirSync(join(root, "Office"));
  writeFileSync(join(root, "Office", "okf.config"), ENCODINGS["UTF-16LE with BOM"]!(CONFIG.join("\r\n") + "\r\n"));
  const cli = fileURLToPath(new URL("../bundle/okf.js", import.meta.url));
  const result = spawnSync("node", [cli, "plan", "spis", join(root, "client", "matter"), "--title", "Synthetic", "--sk", "--json"], { encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).entries.map((entry: { path: string }) => entry.path)).toContain("Drafty/.keep");
});

test.skipIf(!hasWindowsPowerShell)("Windows PowerShell 5.1: office okf.config written by Set-Content -Encoding UTF8 and by > drives the plan", () => {
  mkdirSync(join(root, "Office"));
  for (const how of ["Set-Content -Encoding UTF8", ">"] as const) {
    writeWithWindowsPowerShell(join(root, "Office", "okf.config"), CONFIG, how);
    expectOfficeProfile(join(root, "client", "matter"));
  }
}, WINDOWS_POWERSHELL_TIMEOUT_MS);
