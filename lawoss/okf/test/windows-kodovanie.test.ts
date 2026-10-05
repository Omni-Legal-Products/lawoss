import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "../src/core.ts";
import { plan } from "../src/fs.ts";
import { parseOfficeWorkingProfile } from "../src/profile.ts";
import { parseOnboardingRequest, planOnboarding } from "../src/onboarding/onboarding.ts";
import { hasWindowsPowerShell, WINDOWS_POWERSHELL_TIMEOUT_MS, writeWithWindowsPowerShell } from "../../tests/windows-powershell.mts";

// Kancelársky profil v okf.config z Poznámkového bloku alebo PowerShellu 5.1 (BOM, UTF-16, CRLF)
// musí nový spis dostať rovnako ako okf-memory; inak onboarding spadne na prvom riadku.
let root = "";
// Natívny realpath ako kontrola kanonickej cesty v onboardingu: %TEMP% na windows-2022 obsahuje
// krátke meno 8.3 (RUNNER~1), ktoré JS realpathSync nerozvinie.
beforeEach(() => { root = realpathSync.native(mkdtempSync(join(tmpdir(), "okf-win-kod-"))); });
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

test("an ANSI diacritic in matter_folders stops the plan instead of creating a damaged folder", () => {
  // Windows-1250 „á“ = 0xE1: bez kontroly by vznikol priečinok „N\uFFFDvrhy“.
  mkdirSync(join(root, "Office"));
  writeFileSync(join(root, "Office", "okf.config"), Buffer.from('matter_folders: ["Podklady", "Návrhy"]\r\nfolder_roles:\r\n  drafts: Návrhy\r\n', "latin1"));
  expect(() => plan({ type: "spis", dir: join(root, "client", "matter"), title: "Synthetic", jurisdiction: "sk" })).toThrow(/^okf\.config kancelárie nie je v UTF-8.*ulož ho ako UTF-8: matter_folders obsahuje poškodený znak \(U\+FFFD\)$/);
});

test("the office profile parser ignores a BOM that another reader left before the first key", () => {
  // Appka a staršie čítania dostanú text s U+FEFF; matter_folders na prvom riadku nesmie zmiznúť.
  const profile = parseOfficeWorkingProfile('\uFEFFmatter_folders: ["Podklady", "Drafty"]\r\nfolder_roles:\r\n  drafts: Drafty\r\n');
  expect(profile?.folders).toEqual(["Podklady", "Drafty"]);
  expect(profile?.roles).toEqual({ drafts: "Drafty" });
  // Duplicitný kľúč za BOM sa nesmie potichu prebrať z druhého riadku.
  expect(() => parseOfficeWorkingProfile('\uFEFFmatter_folders: ["A"]\nmatter_folders: ["B"]\n')).toThrow("Duplicitný kľúč pracovného profilu");
});

test("onboarding of a new matter reads a UTF-16LE office okf.config like the CLI", async () => {
  mkdirSync(join(root, "Office"));
  writeFileSync(join(root, "Office", "okf.config"), ENCODINGS["UTF-16LE with BOM"]!(CONFIG.join("\r\n") + "\r\n"));
  const client = join(root, "Klient");
  mkdirSync(client);
  writeFileSync(join(client, "client.md"), "---\ntype: client\n---\n");
  const preview = await planOnboarding(parseOnboardingRequest({ action: "matter", clientRoot: client, parent: client, title: "Zmluva", date: "2026-10-05", kind: "non_contentious", area: "IP", jurisdiction: "sk" }));
  if (preview.mode !== "new") throw new Error("Expected matter plan.");
  const paths = preview.plan.operations.map((operation) => operation.path);
  expect(paths.some((path) => /(^|\/)Drafty$/.test(path))).toBe(true);
  expect(paths.some((path) => /(^|\/)03_Drafty$/.test(path))).toBe(false);
});

test("onboarding of a new matter under an Office folder without okf.config uses the default profile", async () => {
  // Kancelária bez konfigurácie je platný stav (appka: „Predvolený profil“); CLI ho tak berie tiež.
  mkdirSync(join(root, "Office"));
  const client = join(root, "Klient");
  mkdirSync(client);
  writeFileSync(join(client, "client.md"), "---\ntype: client\n---\n");
  const preview = await planOnboarding(parseOnboardingRequest({ action: "matter", clientRoot: client, parent: client, title: "Zmluva", date: "2026-10-05", kind: "non_contentious", area: "IP", jurisdiction: "sk" }));
  if (preview.mode !== "new") throw new Error("Expected matter plan.");
  expect(preview.plan.operations.some((operation) => /(^|\/)03_Drafty$/.test(operation.path))).toBe(true);
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
