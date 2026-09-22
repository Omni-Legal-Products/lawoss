import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readScope, syncStatus, writeIndex, writeLog, findClientDir } from "../src/store.ts";
import { serializeRecord } from "../src/record.ts";
import { newRecord } from "../src/index.ts";

const record = (id: string, type: "subject" | "lesson" | "question") => newRecord({ id, type, jurisdiction: "sk", title: id, description: id, truth: "Obsah", created: "2026-09-20", updated: "2026-09-20", timeline: [{ date: "2026-09-20", text: id }] });
function setup() {
  const root = mkdtempSync(join(tmpdir(), "okf-projection-"));
  const client = join(root, "Klient");
  const matter = join(client, "Veci/a/b/c/d/Vec");
  const office = join(root, "Office");
  for (const dir of [client, matter, office]) mkdirSync(join(dir, "memory"), { recursive: true });
  writeFileSync(join(client, "client.md"), "---\ntype: client\n---\n");
  writeFileSync(join(client, "memory", "S-001.md"), serializeRecord(record("S-001", "subject")));
  writeFileSync(join(office, "memory", "L-001.md"), serializeRecord(record("L-001", "lesson")));
  writeFileSync(join(matter, "_STATUS.md"), "<!-- okf:parties:start -->\n<!-- okf:parties:end -->\n");
  return { root, client, matter, office };
}
test("projection and deep client lookup use complete matter/client/office scope", () => {
  const { client, matter } = setup();
  assert.equal(findClientDir(matter), client);
  syncStatus(matter); writeIndex(matter); writeLog(matter);
  assert.match(readFileSync(join(matter, "_STATUS.md"), "utf8"), /S-001/);
  for (const file of ["index.md", "log.md"]) {
    const content = readFileSync(join(matter, "memory", file), "utf8");
    assert.match(content, /S-001/); assert.match(content, /L-001/);
  }
});
test("every projection rejects incomplete client memory and preserves its previous bytes", () => {
  const { client, matter } = setup();
  writeFileSync(join(client, "memory", "broken.md"), "broken");
  for (const [file, project] of [["_STATUS.md", syncStatus], ["memory/index.md", writeIndex], ["memory/log.md", writeLog]] as const) {
    writeFileSync(join(matter, file), "previous projection");
    assert.throws(() => project(matter), /NEÚPLNÉ ČÍTANIE/);
    assert.equal(readFileSync(join(matter, file), "utf8"), "previous projection");
  }
});
test("duplicate IDs across scope are diagnosed before projections", () => {
  const { client, matter } = setup();
  writeFileSync(join(matter, "memory", "S-001.md"), readFileSync(join(client, "memory", "S-001.md")));
  assert.ok(readScope(matter).problems.some((p) => /S-001/.test(p.message)));
  assert.throws(() => syncStatus(matter));
});
