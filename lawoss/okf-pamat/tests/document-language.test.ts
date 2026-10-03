import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.ts";
import { newRecord } from "../src/index.ts";
import { serializeRecord } from "../src/record.ts";
import { readStore, syncProjections, documentLanguageFromCard } from "../src/store.ts";
import { renderStatus, retrofitStatus, statusSkeleton, manualStatusContent } from "../src/render.ts";
import type { DocumentLanguage } from "../src/document-language.ts";

const languages: readonly DocumentLanguage[] = ["cs", "sk", "en"];
for (const jurisdiction of ["cz", "sk"] as const) {
  for (const language of languages) {
    test(`${language} documents retain ${jurisdiction} law and source records`, () => {
      const dir = mkdtempSync(join(tmpdir(), "okf-language-"));
      const card = `---\ntype: spis\njurisdiction: ${jurisdiction}\nlanguage: "${language}"\n---\n`;
      writeFileSync(join(dir, "matter.md"), card);
      const result = runCli(["init", dir, "--apply"]);
      assert.equal(result.code, 0, result.out);
      const record = newRecord({ id: "D-001", type: "decision", jurisdiction,
        title: "Original source title", description: "Original description", created: "2026-09-22", updated: "2026-09-22",
        truth: "Untranslated source content.", timeline: [{ date: "2026-09-22", kind: "decision", text: "Original event text" }],
        deadlines: ["2026-10-01"] });
      const recordText = serializeRecord(record);
      writeFileSync(join(dir, "memory/D-001.md"), recordText);
      const manual = "\n## My note\nDo not translate this client-authored text.\n";
      const statusPath = join(dir, "_STATUS.md");
      writeFileSync(statusPath, readFileSync(statusPath, "utf8") + manual);
      syncProjections(dir);
      const status = readFileSync(statusPath, "utf8");
      const brain = readFileSync(join(dir, "BRAIN.md"), "utf8");
      const index = readFileSync(join(dir, "memory/index.md"), "utf8");
      const log = readFileSync(join(dir, "memory/log.md"), "utf8");
      assert.equal(readFileSync(join(dir, "matter.md"), "utf8"), card);
      assert.equal(readFileSync(join(dir, "memory/D-001.md"), "utf8"), recordText);
      assert.equal(readStore(dir).records[0]?.jurisdiction, jurisdiction);
      assert.ok(status.endsWith(manual));
      assert.ok(status.includes("Original event text"));
      assert.ok(log.includes("Original event text"));
      if (language === "cs") {
        assert.match(status, /## Lhůty/);
        assert.match(status, /Datum \| Věc \| Záznam/);
        assert.match(brain, /nezpracované vstupy/);
        assert.match(index, /Rejstřík paměti/);
        assert.match(log, /Historie spisu/);
      } else if (language === "sk") {
        assert.match(status, /## Lehoty/);
        assert.match(index, /Register pamäte/);
        assert.match(brain, /protokol pamäte/);
        assert.match(log, /História spisu/);
      } else {
        assert.match(status, /## Deadlines/);
        assert.match(status, /Date \| Matter \| Record/);
        assert.match(brain, /matter memory protocol/);
        assert.match(index, /Memory index/);
        assert.match(log, /Matter history/);
        assert.match(log, /\*\*decision\*\*/);
      }
      const preview = runCli(["sync", dir]);
      assert.equal(preview.code, 0, preview.out);
      assert.match(preview.out, /bez zmeny/);
      syncProjections(dir);
      assert.equal(readFileSync(statusPath, "utf8"), status);
      assert.equal(runCli(["init", dir, "--apply"]).code, 0);
      assert.equal(readFileSync(join(dir, "BRAIN.md"), "utf8"), brain);
    });
  }
}

test("legacy cards without language retain jurisdiction fallback; language in body is ignored", () => {
  const dir = mkdtempSync(join(tmpdir(), "okf-language-legacy-"));
  writeFileSync(join(dir, "matter.md"), "---\ntype: spis\njurisdiction: sk\n---\nlanguage: en\n");
  assert.equal(documentLanguageFromCard(dir), undefined);
  assert.equal(runCli(["init", dir, "--apply"]).code, 0);
  assert.match(readFileSync(join(dir, "BRAIN.md"), "utf8"), /protokol pamäte/);
});

test("legacy multiline and nested card metadata never becomes a strict record-parser error", () => {
  for (const languageLine of ["", "language: cs\n", 'language: "en"\n']) {
    const dir = mkdtempSync(join(tmpdir(), "okf-language-multiline-"));
    writeFileSync(join(dir, "matter.md"), `---\ntype: spis\njurisdiction: cz\n${languageLine}description: |\n  User-authored description.\n  With another line.\ncustom_metadata:\n  language: sk\n  note: retained\n---\n`);
    assert.equal(documentLanguageFromCard(dir), languageLine.includes('"en"') ? "en" : languageLine ? "cs" : undefined);
    assert.equal(runCli(["init", dir, "--apply"]).code, 0);
    syncProjections(dir);
    assert.match(readFileSync(join(dir, "BRAIN.md"), "utf8"), languageLine.includes('"en"') ? /matter memory protocol/ : /protokol paměti/);
  }
  const dir = mkdtempSync(join(tmpdir(), "okf-language-duplicate-"));
  writeFileSync(join(dir, "matter.md"), "---\nlanguage: cs\nlanguage: en\n---\n");
  assert.throws(() => documentLanguageFromCard(dir), /Duplicate document language/);
});

test("English retrofit recognizes headings and preserves manual content", () => {
  const manual = "# My matter\n\n## Deadlines\nManual source note.\n\n## Timeline\nAnother note.\n";
  const retrofit = retrofitStatus(manual, [], "cz", undefined, "en");
  assert.deepEqual(retrofit.inserted, ["deadlines", "timeline"]);
  assert.match(retrofit.text, /Manual source note/);
  assert.equal(renderStatus(retrofit.text, [], "cz", undefined, "en"), retrofit.text);
  assert.doesNotMatch(manualStatusContent(statusSkeleton("cz", "en")), /## (Deadlines|Timeline|Parties|Matter facts)/);
});

test("present empty or non-scalar document language is rejected before init writes", () => {
  for (const value of ["", ' ""', "\n  - de", "\n  name: de", " |\n  en", " [cs, en]"]) {
    const dir = mkdtempSync(join(tmpdir(), "okf-language-nonscalar-"));
    const card = `---\ntype: spis\njurisdiction: cz\nlanguage:${value}\n---\n`;
    writeFileSync(join(dir, "matter.md"), card);
    assert.throws(() => documentLanguageFromCard(dir), /Unsupported document language/);
    assert.notEqual(runCli(["init", dir, "--apply"]).code, 0);
    assert.equal(readFileSync(join(dir, "matter.md"), "utf8"), card);
    assert.equal(existsSync(join(dir, "BRAIN.md")), false);
    assert.equal(existsSync(join(dir, "_STATUS.md")), false);
  }
});

test("invalid language in shared client card fails before any projection write", () => {
  const client = mkdtempSync(join(tmpdir(), "okf-language-invalid-"));
  const dir = join(client, "Spisy", "matter");
  mkdirSync(join(dir, "memory"), { recursive: true });
  writeFileSync(join(client, "client.md"), "---\ntype: klient\nlanguage: de\n---\n");
  writeFileSync(join(dir, "matter.md"), "---\ntype: spis\njurisdiction: cz\nlanguage: en\n---\n");
  const before = statusSkeleton("cz", "en");
  writeFileSync(join(dir, "_STATUS.md"), before);
  assert.throws(() => syncProjections(dir), /Unsupported document language/);
  assert.equal(readFileSync(join(dir, "_STATUS.md"), "utf8"), before);
});
