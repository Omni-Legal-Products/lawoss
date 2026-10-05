import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandoff } from "./checkpoint.mjs";
import { newRecord, serializeRecord } from "../okf-pamat/src/index.ts";
import { hasWindowsPowerShell, writeWithWindowsPowerShell } from "../tests/windows-powershell.mts";

// Karta veci uložená na Windows: Poznámkový blok a PowerShell 5.1 zapíšu BOM alebo UTF-16.
// Odmietnutá karta znamenala tichý koniec OKF kontextu pri zhutnení.
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const CARD = "---\r\ntype: spis\r\njurisdiction: sk\r\n---\r\n# Syntetická vec Novák\r\n";
const ENCODINGS: Record<string, (text: string) => Buffer> = {
  "UTF-8 with BOM": (text) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]),
  "UTF-16LE with BOM": (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]),
  "UTF-16BE with BOM": (text) => Buffer.from(`﻿${text}`, "utf16le").swap16(),
};

function matter(card: Buffer | null): string {
  const root = mkdtempSync(join(tmpdir(), "okf-handoff-bom-")); roots.push(root);
  if (card) writeFileSync(join(root, "matter.md"), card);
  mkdirSync(join(root, "memory"));
  writeFileSync(join(root, "memory", "F-001.md"), serializeRecord(newRecord({
    id: "F-001", type: "fact", jurisdiction: "sk", title: "Doručenie", description: "syntetické",
    created: "2026-09-02", updated: "2026-09-02", truth: "Žaloba doručená.", timeline: [{ date: "2026-09-02", text: "Vzniklo" }],
  })));
  return root;
}

async function expectCheckpoint(root: string) {
  const handoff = createHandoff(root);
  expect(handoff).not.toBeNull();
  const result = await handoff!.checkpoint("ses_bom", "before-compaction");
  expect(result.ok).toBe(true);
  expect(result.context).toContain("Žaloba doručená.");
  expect(readFileSync(result.path!, "utf8")).toMatch(/card_sha256: [a-f0-9]{64}/);
}

for (const [name, encode] of Object.entries(ENCODINGS)) {
  test(`matter card in ${name} binds and the real CLI checkpoint carries OKF context`, async () => {
    await expectCheckpoint(matter(encode(CARD)));
  });
}

test("BOM card with a wrong type still does not bind", () => {
  expect(createHandoff(matter(ENCODINGS["UTF-8 with BOM"]!("---\ntype: klient\n---\n")))).toBeNull();
});

test("the same card in two encodings is one consistent card", () => {
  const root = matter(ENCODINGS["UTF-16LE with BOM"]!(CARD));
  writeFileSync(join(root, "spis.md"), ENCODINGS["UTF-8 with BOM"]!(CARD));
  expect(createHandoff(root)).not.toBeNull();
});

test("an ANSI byte only in a comment of okf.config keeps client_path scope in the checkpoint", async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "okf-handoff-ansi-"))); roots.push(base);
  const client = join(base, "AK", "Novák Jan");
  const root = join(client, "vec");
  mkdirSync(join(root, "memory"), { recursive: true });
  mkdirSync(join(client, "memory"), { recursive: true });
  mkdirSync(join(base, "Office", "memory"), { recursive: true });
  // PowerShell 5.1 `Set-Content` bez -Encoding: ANSI „á“ v poznámke, vzor klienta je ASCII.
  writeFileSync(join(base, "Office", "okf.config"), Buffer.from("client_path: AK/*\r\n# poznámka kancelárie\r\n", "latin1"));
  writeFileSync(join(root, "matter.md"), CARD);
  writeFileSync(join(client, "memory", "F-101.md"), serializeRecord(newRecord({
    id: "F-101", type: "fact", jurisdiction: "sk", title: "Klient", description: "syntetické",
    created: "2026-09-02", updated: "2026-09-02", truth: "Klient platí zálohy včas.", timeline: [{ date: "2026-09-02", text: "Vzniklo" }],
  })));
  const handoff = createHandoff(root, { resolveAllowedRoots: async () => [base] });
  expect(handoff).not.toBeNull();
  const result = await handoff!.checkpoint("ses_ansi", "before-compaction");
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(result.context).toContain("Klient platí zálohy včas.");
});

test.skipIf(!hasWindowsPowerShell)("Windows PowerShell 5.1: card written by Set-Content -Encoding UTF8 and by > binds", async () => {
  const lines = ["---", "type: spis", "jurisdiction: sk", "---", "# Syntetická vec Novák"];
  for (const how of ["Set-Content -Encoding UTF8", ">"] as const) {
    const root = matter(null);
    const bytes = writeWithWindowsPowerShell(join(root, "matter.md"), lines, how);
    expect(bytes[0]).toBe(how === ">" ? 0xff : 0xef);
    await expectCheckpoint(root);
  }
});
