import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { newRecord } from "../src/index.ts";
import { type OkfRecord } from "../src/record.ts";
import { planWrite, TimelineIntegrityError, StaleUpdatedError } from "../src/write.ts";
import { applyRecordWrite, readStore, ConcurrentWriteError } from "../src/store.ts";

function record(): OkfRecord {
  return newRecord({ id: "D-001", type: "decision", jurisdiction: "sk", title: "Test",
    description: "Test", truth: "Pôvodný stav", created: "2026-01-01", updated: "2026-01-01",
    timeline: [{ date: "2026-01-01", text: "Založenie" }], deadlines: ["2026-10-01"] });
}

function traced(before: OkfRecord, patch: Partial<OkfRecord>): OkfRecord {
  const today = new Date().toISOString().slice(0, 10);
  return { ...before, ...patch, updated: today, timeline: [...before.timeline, { date: today, text: "Oprava údajov" }] };
}

for (const [field, patch] of Object.entries({
  deadlines: { deadlines: ["2026-11-01"] }, status: { status: "void" },
  sources: { sources: [{ title: "Nový zdroj", resource: "local.md" }] },
  verified: { verified: [{ by: "Reviewer", at: "2026-09-20" }] },
  extra: { extra: { custom: "changed" } }, title: { title: "Nový titul" },
  related: { related: ["D-002"] }, due: { due: "2026-11-01" },
})) {
  test(`${field}: substantive metadata requires append-only history`, () => {
    const before = record();
    assert.throws(() => planWrite(before, { ...before, ...patch }, "Oprava"), TimelineIntegrityError);
  });
  test(`${field}: diff shows changed metadata`, () => {
    const before = record();
    const diff = planWrite(before, traced(before, patch), "Oprava");
    assert.ok(diff.lines.some((line) => line.includes(field)), diff.lines.join("\n"));
  });
}

test("metadata update requires updated to advance and rejects going backwards", () => {
  const before = record();
  const after = traced(before, { deadlines: ["2026-11-01"] });
  assert.throws(() => planWrite(before, { ...after, updated: before.updated }, "Oprava"), StaleUpdatedError);
  assert.throws(() => planWrite(before, { ...after, updated: "2025-12-31" }, "Oprava"), StaleUpdatedError);
});

test("same-day stale write cannot restore the previous deadline", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "okf-revision-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const before = { ...record(), updated: new Date().toISOString().slice(0, 10) };
  applyRecordWrite(dir, planWrite(undefined, before, "Založenie"), undefined);
  applyRecordWrite(dir, planWrite(before, traced(before, { deadlines: ["2026-11-01"] }), "A"), undefined);
  assert.throws(() => applyRecordWrite(dir, planWrite(before, traced(before, { truth: "B" }), "B"), undefined), ConcurrentWriteError);
  assert.deepEqual(readStore(dir).records[0]?.deadlines, ["2026-11-01"]);
});

test("creation cannot replace an existing id, and stale updates cannot resurrect deleted records", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "okf-revision-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const before = record();
  applyRecordWrite(dir, planWrite(undefined, before, "Založenie"), undefined);
  assert.throws(() => applyRecordWrite(dir, planWrite(undefined, { ...before, truth: "Lost" }, "Duplicate"), undefined), ConcurrentWriteError);
  applyRecordWrite(dir, planWrite(before, undefined, "Delete"), { by: "Reviewer", at: new Date().toISOString() });
  assert.throws(() => applyRecordWrite(dir, planWrite(before, traced(before, { truth: "Resurrected" }), "Update"), undefined), ConcurrentWriteError);
});

test("two processes cannot both commit from one revision", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "okf-process-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const before = { ...record(), updated: new Date().toISOString().slice(0, 10) };
  applyRecordWrite(dir, planWrite(undefined, before, "Založenie"), undefined);
  const storeUrl = new URL("../src/store.ts", import.meta.url).href;
  const writeUrl = new URL("../src/write.ts", import.meta.url).href;
  const script = `
    import fs from 'node:fs';
    import { basename, dirname } from 'node:path';
    import { syncBuiltinESMExports } from 'node:module';
    const [dir, pause, storeUrl, writeUrl, beforeJson] = process.argv.slice(1);
    const before = JSON.parse(beforeJson);
    const original = fs.writeFileSync;
    // Hold the first process after its read, immediately before its real disk write.
    // All filesystem writes still happen; this only controls process scheduling.
    if (pause === 'yes') {
      fs.writeFileSync = (...args) => {
        if (basename(dirname(String(args[0]))) === 'memory') {
          process.send('ready');
          const until = Date.now() + 10000;
          while (!fs.existsSync(dir + '/release')) {
            if (Date.now() > until) throw Error('Test rendezvous timed out');
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
          }
        }
        return original(...args);
      };
      syncBuiltinESMExports();
    }
    const { applyRecordWrite, ConcurrentWriteError } = await import(storeUrl);
    const { planWrite } = await import(writeUrl);
    const after = { ...before, truth: pause, timeline: [...before.timeline, { date: before.updated, text: pause }] };
    try { applyRecordWrite(dir, planWrite(before, after, 'Concurrent'), undefined); }
    catch (error) { if (error instanceof ConcurrentWriteError) process.exitCode = 3; else throw error; }
  `;
  const args = ["--input-type=module", "--eval", script, dir];
  const first = spawn(process.execPath, [...args, "yes", storeUrl, writeUrl, JSON.stringify(before)], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  t.after(() => first.kill());
  const firstExit = once(first, "exit");
  await Promise.race([once(first, "message"), firstExit.then(() => { throw new Error("First process exited before rendezvous"); })]);
  const second = spawn(process.execPath, [...args, "no", storeUrl, writeUrl, JSON.stringify(before)], { stdio: "pipe" });
  t.after(() => second.kill());
  const [secondCode] = await once(second, "exit");
  writeFileSync(join(dir, "release"), "go");
  const [firstCode] = await firstExit;
  assert.equal(firstCode, 0);
  assert.equal(secondCode, 3, "second process must reject while first holds the write critical section");
  assert.equal(readStore(dir).records[0]?.truth, "yes");
  assert.deepEqual(readdirSync(join(dir, "memory")).filter((name) => !name.endsWith(".md")), []);
  assert.match(readFileSync(join(dir, "memory", readdirSync(join(dir, "memory"))[0]!), "utf8"), /## History/);
});
