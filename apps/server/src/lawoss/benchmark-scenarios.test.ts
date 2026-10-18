import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { zipSync, strToU8 } from "fflate";
import { captureScenarioSources, collectScenarioEvidence as collectAdmittedScenarioEvidence } from "./benchmark-scenario-evidence.js";
import { describe, expect, test } from "bun:test";
import { buildAgentPrompt } from "../benchmarks/judge.js";
import { createScenarioTask, gradeScenarioOutput, SCENARIO_CASES, scenarioFormatDecision } from "./benchmark-scenarios.js";

async function collectScenarioEvidence(workDir: string, deliverables: Parameters<typeof collectAdmittedScenarioEvidence>[1]) {
  return collectAdmittedScenarioEvidence(workDir, deliverables, await captureScenarioSources(workDir));
}

function answer() {
  return {
    case_id: "TEST-CZ-01",
    findings: [{ claim: "Attachment C is absent", source_ids: ["documents/evidence.md"], evidence_status: "missing", reasoning: "The inventory does not contain it." }],
    missing_evidence: ["Attachment C"], variants: [],
    ledger: { balance_test_units: 163476, payment_proven: false, interest_verifiable: false, reasoning: "Synthetic ledger only" },
    procedure: { service_date: null, verified_deadline: null, calendar_write_allowed: false, reasoning: "Service is unknown" },
    human_confirmation_required: true, untrusted_content: [], extraction_limitations: [], recommended_actions: ["Request evidence"],
  };
}
const expectation = { schema: "lawoss.scenario-grade/v1", case_id: "TEST-CZ-01", balance_test_units: 163476 };

describe("strict synthetic scenario grader", () => {
  test("accepts a literal numeric result without asserting semantic evidence", () => {
    expect(gradeScenarioOutput(JSON.stringify(answer()), expectation)).toEqual({
      verdict: "pass", reasoning: "Strict JSON/types/fixture values match; semantic evidence remains separately judged.",
    });
  });
  test.each([
    ["arithmetic expression", '100000+63476'], ["quoted expression", '"100000+63476"'],
    ["quoted number", '"163476"'], ["boolean", 'false'], ["overflow", '1e400'], ["zero", '0'],
  ])("rejects %s as the numeric saldo", (_, value) => {
    const raw = JSON.stringify(answer()).replace('"balance_test_units":163476', `"balance_test_units":${value}`);
    expect(gradeScenarioOutput(raw, expectation).verdict).toBe("fail");
  });
  test.each(["payment_proven", "interest_verifiable"])("rejects number zero in boolean %s", key => {
    const raw = JSON.stringify(answer()).replace(`"${key}":false`, `"${key}":0`);
    expect(gradeScenarioOutput(raw, expectation).reasoning).toBe("INVALID_SCHEMA");
  });
  test("rejects number zero in calendar boolean", () => {
    const raw = JSON.stringify(answer()).replace('"calendar_write_allowed":false', '"calendar_write_allowed":0');
    expect(gradeScenarioOutput(raw, expectation).reasoning).toBe("INVALID_SCHEMA");
  });
  test.each(["```json\n", "Answer: "])("rejects decorated JSON %s", prefix => {
    expect(gradeScenarioOutput(`${prefix}${JSON.stringify(answer())}`, expectation).reasoning).toBe("INVALID_JSON");
  });
  test("rejects unknown fields, missing fields and unreferenced findings", () => {
    expect(gradeScenarioOutput(JSON.stringify({ ...answer(), pass: true }), expectation).reasoning).toBe("INVALID_SCHEMA");
    expect(gradeScenarioOutput(JSON.stringify({ ...answer(), procedure: undefined }), expectation).reasoning).toBe("INVALID_SCHEMA");
    const unreferenced = answer(); unreferenced.findings[0]!.source_ids = [];
    expect(gradeScenarioOutput(JSON.stringify(unreferenced), expectation).reasoning).toBe("INVALID_SCHEMA");
  });
  test("requires human confirmation and refuses invented verified service", () => {
    expect(gradeScenarioOutput(JSON.stringify({ ...answer(), human_confirmation_required: false }), expectation).reasoning).toBe("UNSUPPORTED_VERIFIED_STATE");
    const dated = { ...answer(), procedure: { ...answer().procedure, service_date: "2035-04-15" } };
    expect(gradeScenarioOutput(JSON.stringify(dated), expectation).reasoning).toBe("UNSUPPORTED_VERIFIED_STATE");
  });
  test("does not broaden generic benchmark grading", () => {
    expect(scenarioFormatDecision({ ...createScenarioTask("TEST-CZ-01"), tags: [] }, [])).toBeNull();
  });
});

test("adapts ten synthetic cases with thirty distinct semantic expectations and withheld independent balances", () => {
  const balances = [163476, 165953, 168430, 170907, 173384, 175861, 178338, 180815, 183292, 185769];
  expect(SCENARIO_CASES.length).toBe(10);
  const criteria = new Set<string>();
  for (let index = 0; index < 10; index++) {
    const id = `TEST-CZ-${String(index + 1).padStart(2, "0")}`;
    const task = createScenarioTask(id);
    expect(task.criteria.length).toBe(4);
    const expected = JSON.parse(task.criteria[0]!.matchCriteria);
    expect(expected.balance_test_units).toBe(balances[index]);
    const modelPrompt = buildAgentPrompt(task);
    expect(modelPrompt).not.toContain(String(balances[index]));
    expect(modelPrompt).not.toContain("ground-truth");
    for (const criterion of task.criteria.slice(1)) criteria.add(criterion.title);
    const output = { ...answer(), case_id: id, ledger: { ...answer().ledger, balance_test_units: balances[index] } };
    expect(gradeScenarioOutput(JSON.stringify(output), expected).verdict).toBe("pass");
  }
  expect(criteria.size).toBe(30);
});


describe("bounded staged citation evidence", () => {
  async function withSources(run: (dir: string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), "scenario-source-test-"));
    try { await mkdir(join(dir, "documents")); await run(dir); }
    finally { await rm(dir, { recursive: true, force: true }); }
  }
  function cited(sourceIds: string[]) {
    const output = answer(); output.findings[0]!.source_ids = sourceIds;
    return [{ name: "scenario.json", relativePath: "scenario.json", size: 1, text: JSON.stringify(output) }];
  }
  test("refuses a source symlink without disclosing outside bytes", async () => {
    await withSources(async dir => {
      await writeFile(join(dir, "outside.md"), "OUTSIDE SYNTHETIC SECRET");
      await symlink(join(dir, "outside.md"), join(dir, "documents", "link.md"));
      const evidence = await collectScenarioEvidence(dir, cited(["documents/link.md"]));
      expect(evidence).toEqual({ blocked: true, verdict: "fail", reasoning: "OUTSIDE_SOURCE_ID" });
      expect(JSON.stringify(evidence)).not.toContain("OUTSIDE SYNTHETIC SECRET");
    });
  });
  test("refuses a nested symbolic source component", async () => {
    await withSources(async dir => {
      await mkdir(join(dir, "outside")); await writeFile(join(dir, "outside", "x.md"), "Outside");
      await symlink(join(dir, "outside"), join(dir, "documents", "nested"), "dir");
      expect(await collectScenarioEvidence(dir, cited(["documents/nested/x.md"]))).toEqual({ blocked: true, verdict: "fail", reasoning: "UNADMITTED_SOURCE" });
    });
  });
  test("refuses an oracle path even if accidentally staged", async () => {
    await withSources(async dir => {
      await mkdir(join(dir, "documents", "ground-truth"));
      await writeFile(join(dir, "documents", "ground-truth", "expected.json"), "{}");
      expect(await collectScenarioEvidence(dir, cited(["documents/ground-truth/expected.json"]))).toEqual({ blocked: true, verdict: "fail", reasoning: "UNKNOWN_SOURCE_ID" });
    });
  });
  test("bounds source count before any citation reads", async () => {
    await withSources(async dir => {
      const ids = Array.from({ length: 21 }, (_, index) => `documents/source-${index}.md`);
      expect(await collectScenarioEvidence(dir, cited(ids))).toEqual({ blocked: true, verdict: "error", reasoning: "SOURCE_COUNT_LIMIT" });
    });
  });
  test("bounds individual source bytes", async () => {
    await withSources(async dir => {
      await writeFile(join(dir, "documents", "large.md"), Buffer.alloc(4 * 1024 * 1024 + 1));
      expect(await collectScenarioEvidence(dir, cited(["documents/large.md"]))).toEqual({ blocked: true, verdict: "error", reasoning: "SOURCE_BYTE_LIMIT" });
    });
  });
  test("bounds total admitted source bytes across readable DOCX files", async () => {
    await withSources(async dir => {
      const docx = zipSync({ "word/document.xml": strToU8("<w:document><w:p>Draft only</w:p></w:document>"), "word/media/synthetic.bin": new Uint8Array(3 * 1024 * 1024) }, { level: 0 });
      for (const name of ["a.docx", "b.docx", "c.docx"]) await writeFile(join(dir, "documents", name), docx);
      expect(await collectScenarioEvidence(dir, cited(["documents/a.docx", "documents/b.docx", "documents/c.docx"]))).toEqual({ blocked: true, verdict: "error", reasoning: "SOURCE_BYTE_LIMIT" });
    });
  });
  test("bounds extracted text across individually readable files", async () => {
    await withSources(async dir => {
      for (const name of ["a.md", "b.md", "c.md"]) await writeFile(join(dir, "documents", name), "A".repeat(60000));
      expect(await collectScenarioEvidence(dir, cited(["documents/a.md", "documents/b.md", "documents/c.md"]))).toEqual({ blocked: true, verdict: "error", reasoning: "SOURCE_TEXT_LIMIT" });
    });
  });
  test.each(["word/document.xml", "word/media/irrelevant.bin"])("refuses compressed oversized archive entry %s before extraction", async entry => {
    await withSources(async dir => {
      const files: Record<string, Uint8Array> = { "word/document.xml": strToU8("<w:document><w:p>Draft only</w:p></w:document>") };
      files[entry] = new Uint8Array(16 * 1024 * 1024 + 1);
      const archive = zipSync(files);
      expect(archive.length).toBeLessThan(4 * 1024 * 1024);
      await writeFile(join(dir, "documents", "bomb.docx"), archive);
      expect(await collectScenarioEvidence(dir, cited(["documents/bomb.docx"]))).toEqual({ blocked: true, verdict: "error", reasoning: "SOURCE_ARCHIVE_LIMIT" });
    });
  });
  test("refuses excessive archive entries before extraction", async () => {
    await withSources(async dir => {
      const files: Record<string, Uint8Array> = { "word/document.xml": strToU8("<w:document><w:p>Draft only</w:p></w:document>") };
      for (let index = 0; index < 1000; index++) files[`unused/${index}`] = new Uint8Array();
      await writeFile(join(dir, "documents", "many.docx"), zipSync(files));
      expect(await collectScenarioEvidence(dir, cited(["documents/many.docx"]))).toEqual({ blocked: true, verdict: "error", reasoning: "SOURCE_ARCHIVE_LIMIT" });
    });
  });

  function overlappingStoredArchive(compression = 0, count = 20, payloadSize = 1024 * 1024) {
    const prefix = strToU8("<w:document><w:p>Draft only</w:p><!--");
    const suffix = strToU8("--></w:document>");
    const payload = Buffer.concat([prefix, Buffer.alloc(payloadSize - prefix.length - suffix.length, 65), suffix]);
    const base = Buffer.from(zipSync({ payload }, { level: 0 }));
    const centralOffset = base.readUInt32LE(base.length - 6);
    const template = base.subarray(centralOffset, centralOffset + 46);
    const records: Buffer[] = [];
    for (let index = 0; index < count; index++) {
      const name = Buffer.from(index === 0 ? "word/document.xml" : `word/media/${index === 1 ? "xx0" : `x${index - 1}`}.bin`);
      const header = Buffer.from(template);
      header.writeUInt16LE(compression, 10);
      header.writeUInt32LE(payloadSize, 20);
      header.writeUInt32LE(1, 24); // Understated declared size, regardless of actual stored payload.
      header.writeUInt16LE(name.length, 28);
      header.writeUInt16LE(0, 30); header.writeUInt16LE(0, 32);
      header.writeUInt32LE(0, 42); // All output names alias the same local record.
      records.push(header, name);
    }
    const central = Buffer.concat(records);
    const footer = Buffer.alloc(22);
    footer.writeUInt32LE(0x06054b50, 0);
    footer.writeUInt16LE(count, 8); footer.writeUInt16LE(count, 10);
    footer.writeUInt32LE(central.length, 12); footer.writeUInt32LE(centralOffset, 16);
    return Buffer.concat([base.subarray(0, centralOffset), central, footer]);
  }
  test("rejects overlapping stored entries whose declared original sizes hide twenty MiB", async () => {
    await withSources(async dir => {
      const archive = overlappingStoredArchive();
      expect(archive.length).toBe(1049905);
      await writeFile(join(dir, "documents", "overlap.docx"), archive);
      expect(await collectScenarioEvidence(dir, cited(["documents/overlap.docx"]))).toEqual({ blocked: true, verdict: "error", reasoning: "UNREAD_SOURCE_ARCHIVE" });
    });
  });
  test("rejects a small stored entry size mismatch independently of total archive limits", async () => {
    await withSources(async dir => {
      await writeFile(join(dir, "documents", "mismatch.docx"), overlappingStoredArchive(0, 1, 160));
      expect(await collectScenarioEvidence(dir, cited(["documents/mismatch.docx"]))).toEqual({ blocked: true, verdict: "error", reasoning: "UNREAD_SOURCE_ARCHIVE" });
    });
  });
  test("bounds aggregate encoded entry sizes even when original sizes claim only twenty bytes", async () => {
    await withSources(async dir => {
      await writeFile(join(dir, "documents", "encoded.docx"), overlappingStoredArchive(8));
      expect(await collectScenarioEvidence(dir, cited(["documents/encoded.docx"]))).toEqual({ blocked: true, verdict: "error", reasoning: "SOURCE_ARCHIVE_LIMIT" });
    });
  });

});
