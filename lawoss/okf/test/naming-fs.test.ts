import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, linkSync, truncateSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { planDocumentNaming, applyDocumentNaming, parseNamingPlan, renameWithRetry } from "../src/naming-fs.ts";
import { holdWindowsFileLock } from "./windows-file-lock.ts";
import { hash, NAMING_LIMITS, parseNamingRequest } from "../src/naming-core.ts";
import { renderWorkingProfile, workingProfile } from "../src/profile.ts";
import { run } from "../src/cli.ts";
const cleanup: string[] = [];
afterEach(() => { for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "okf-naming-"))); cleanup.push(base); const root = join(base, "matter"); mkdirSync(root);
  const profile = workingProfile(); for (const folder of profile.folders) mkdirSync(join(root, folder), { recursive: true }); mkdirSync(join(root, "notes"));
  writeFileSync(join(root, "PRACOVNY-PROFIL.md"), renderWorkingProfile(profile));
  const binary = Buffer.from([0, 255, 254, 128, 13, 10, 80, 68, 70]);
  writeFileSync(join(root, "03_Drafty/old.PDF"), binary); writeFileSync(join(root, "01_Podklady/original.pdf"), binary);
  writeFileSync(join(root, "notes/note.md"), '[working](../03_Drafty/old.PDF#page=2)\n[[../01_Podklady/original.pdf|original]]\n');
  const request = parseNamingRequest({ schema: "lawoss.document-naming.request/v1", operationId: "op-1", documents: [
    { id: "working", path: "03_Drafty/old.PDF", treatment: "rename-working", destinationRole: "drafts", metadata: { date: "bez-datumu", description: "working", version: "01" } },
    { id: "original", path: "01_Podklady/original.pdf", treatment: "copy-original-to-drafts", destinationRole: "drafts", metadata: { date: "2026-09-21", description: "original", version: "01" } },
  ], markdownFiles: ["notes/note.md"] });
  return { base, root, request, binary };
}
function tree(root: string): Record<string, string> { const result: Record<string, string> = {}; for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) { const full = join(entry.parentPath, entry.name); result[full] = hash(readFileSync(full)); } else if (entry.isDirectory()) result[join(entry.parentPath, entry.name)] = "directory"; return result; }
function supportsSymlinks(): boolean {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "okf-symlink-probe-")));
  try { writeFileSync(join(base, "file"), "probe"); symlinkSync(join(base, "file"), join(base, "link")); return true; }
  catch (error) { if (typeof error === "object" && error && "code" in error && ["EPERM", "EACCES", "ENOSYS"].includes(String(error.code))) { console.warn("Skipping symlink-specific test: runtime symlink capability unavailable"); return false; } throw error; }
  finally { rmSync(base, { recursive: true, force: true }); }
}
describe("naming filesystem transaction", () => {
  test("file identities above the safe integer limit remain distinct in the Node runtime", async () => {
    const f = fixture(), entry = join(f.base, "identity-entry.ts"), bundle = join(f.base, "identity.mjs");
    writeFileSync(entry, `export { readNamingBinary } from ${JSON.stringify(fileURLToPath(new URL("../src/naming-fs.ts", import.meta.url)))};`);
    const build = await Bun.build({ entrypoints: [entry], target: "node", format: "esm" });
    expect(build.success).toBe(true);
    await Bun.write(bundle, build.outputs[0]!);
    // Isolate filesystem mocking in a child process so no other tests observe it.
    const result = spawnSync("node", ["--input-type=module", "-e", `
      import fs from "node:fs";
      import { syncBuiltinESMExports } from "node:module";
      import { pathToFileURL } from "node:url";
      import assert from "node:assert/strict";
      const ids = new Map();
      let next = 9007199254740992n;
      for (const path of process.argv.slice(2)) {
        const stat = fs.lstatSync(path, { bigint: true });
        ids.set(String(stat.dev) + ":" + String(stat.ino), next++);
      }
      for (const name of ["lstatSync", "fstatSync"]) {
        const original = fs[name];
        fs[name] = (target, options) => {
          const exact = original(target, { bigint: true });
          const key = String(exact.dev) + ":" + String(exact.ino);
          if (!ids.has(key)) ids.set(key, next++);
          const stat = original(target, options);
          stat.ino = options?.bigint ? ids.get(key) : Number(ids.get(key));
          return stat;
        };
      }
      syncBuiltinESMExports();
      const { readNamingBinary } = await import(pathToFileURL(process.argv[1]).href);
      const a = readNamingBinary(process.argv[2], 1024);
      const b = readNamingBinary(process.argv[3], 1024);
      assert.equal(a.physical.split(":")[1], "9007199254740992");
      assert.equal(b.physical.split(":")[1], "9007199254740993");
      assert.notEqual(a.physical, b.physical);
    `, bundle, join(f.root, "03_Drafty/old.PDF"), join(f.root, "01_Podklady/original.pdf")], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
  test("preview has zero writes; binary originals copied, working links updated and replay verified", () => {
    const f = fixture(); writeFileSync(join(f.root, "notes/unselected.md"), "[old](../03_Drafty/old.PDF)");
    const before = tree(f.root), plan = planDocumentNaming(f.root, f.request); expect(tree(f.root)).toEqual(before); expect(plan.linkScope).toContain("unselected");
    expect(plan.documents.map(d => d.source.path)).toEqual(["01_Podklady/original.pdf", "03_Drafty/old.PDF"]);
    expect(applyDocumentNaming(f.root, plan).status).toBe("applied");
    for (const d of plan.documents) expect(readFileSync(join(f.root, d.target.path))).toEqual(f.binary);
    expect(readFileSync(join(f.root, "01_Podklady/original.pdf"))).toEqual(f.binary); expect(existsSync(join(f.root, "03_Drafty/old.PDF"))).toBe(false);
    expect(readFileSync(join(f.root, "notes/note.md"), "utf8")).toContain("../03_Drafty/bez-datumu_working_v01.PDF#page=2");
    expect(readFileSync(join(f.root, "notes/note.md"), "utf8")).toContain("../01_Podklady/original.pdf|original");
    expect(readFileSync(join(f.root, "notes/unselected.md"), "utf8")).toBe("[old](../03_Drafty/old.PDF)");
    expect(applyDocumentNaming(f.root, plan).status).toBe("already-applied");
    writeFileSync(join(f.root, plan.documents[0]!.target.path), "newer"); expect(applyDocumentNaming(f.root, plan).status).toBe("conflict");
  });
  test("saved profile is authoritative; missing and invalid profiles fail closed", () => {
    const f = fixture(); mkdirSync(join(f.root, "Office")); writeFileSync(join(f.root, "Office/okf.config"), "document_naming: ignored");
    expect(planDocumentNaming(f.root, f.request).documents[0]!.target.path).toContain("2026-09-21_original_v01.pdf");
    writeFileSync(join(f.root, "PRACOVNY-PROFIL.md"), "invalid"); expect(() => planDocumentNaming(f.root, f.request)).toThrow();
    rmSync(join(f.root, "PRACOVNY-PROFIL.md")); expect(() => planDocumentNaming(f.root, f.request)).toThrow();
  });
  for (const scenario of [
    { name: "I1 HTML control", source: "a b.PDF", text: '<a href="../03_Drafty/a%20b.PDF">doc</a>' },
    { name: "I1 percent prose", source: "a b.PDF", text: '50% hotovo\n<a href="../03_Drafty/a%20b.PDF">doc</a>' },
    { name: "I1 malformed percent", source: "a b.PDF", text: '%ZZ %2 %FF\n<a href="../03_Drafty/a%20b.PDF">doc</a>' },
    { name: "I2 inline", source: "old.PDF", text: String.raw`[x](../03_Drafty/old\.PDF)` },
    { name: "I2 reference", source: "old.PDF", text: String.raw`[id]: ../03_Drafty/old\.PDF` },
    { name: "I2 angle", source: "old.PDF", text: String.raw`[x](<../03_Drafty/old\.PDF>)` },
    { name: "I2 used reference", source: "old.PDF", text: "[read][id]\n" + String.raw`[id]: ../03_Drafty/old\.PDF` },
  ]) test(`final ${scenario.name}: source and Node bundle refuse preview/apply with zero whole-tree writes`, () => {
    const f = fixture(), source = `03_Drafty/${scenario.source}`;
    if (scenario.source !== "old.PDF") renameSync(join(f.root, "03_Drafty/old.PDF"), join(f.root, source));
    f.request.documents.find(d => d.id === "working")!.path = source;
    writeFileSync(join(f.root, "notes/note.md"), "Unrelated selected note\n");
    const approved = planDocumentNaming(f.root, f.request);
    writeFileSync(join(f.root, "notes/note.md"), scenario.text);
    const manifest = join(f.base, "request.json"), planPath = join(f.base, "approved.json"), out = join(f.base, "preview.json");
    writeFileSync(manifest, JSON.stringify(f.request)); writeFileSync(planPath, JSON.stringify(approved));
    const before = tree(f.base);
    expect(() => planDocumentNaming(f.root, f.request)).toThrow();
    expect(tree(f.base)).toEqual(before);
    expect(applyDocumentNaming(f.root, approved).status).toBe("conflict");
    expect(tree(f.base)).toEqual(before);
    expect(run(["naming", f.root, "--manifest", manifest, "--out", out, "--json"], () => {})).toBe(2);
    expect(tree(f.base)).toEqual(before);
    const cli = fileURLToPath(new URL("../bundle/okf.js", import.meta.url));
    const invoke = (args: string[]) => spawnSync("node", [cli, "naming", f.root, ...args, "--json"], { encoding: "utf8" });
    const preview = invoke(["--manifest", manifest, "--out", out]);
    expect(preview.status).toBe(2); expect(preview.stderr + preview.stdout).toMatch(/unsupported|Uncertain/);
    expect(tree(f.base)).toEqual(before);
    expect(invoke(["--plan", planPath, "--apply"]).status).toBe(1);
    expect(tree(f.base)).toEqual(before);
    expect(existsSync(join(f.root, ".lawoss"))).toBe(false); expect(existsSync(out)).toBe(false);
    expect(readFileSync(join(f.root, source))).toEqual(f.binary);
    expect(readFileSync(join(f.root, "01_Podklady/original.pdf"))).toEqual(f.binary);
    expect(readFileSync(join(f.root, "notes/note.md"), "utf8")).toBe(scenario.text);
  });
  test("CAS rejects source, profile, selected Markdown and physical replacement", () => {
    for (const path of ["03_Drafty/old.PDF", "PRACOVNY-PROFIL.md", "notes/note.md"]) {
      const f = fixture(), plan = planDocumentNaming(f.root, f.request); writeFileSync(join(f.root, path), "newer");
      expect(applyDocumentNaming(f.root, plan).status).toBe("conflict"); expect(existsSync(join(f.root, plan.documents[0]!.target.path))).toBe(false);
    }
    const f = fixture(), plan = planDocumentNaming(f.root, f.request), path = join(f.root, "03_Drafty/old.PDF"); renameSync(path, `${path}.old`); writeFileSync(path, f.binary);
    expect(applyDocumentNaming(f.root, plan).status).toBe("conflict");
  });
  test("targets stay absent and collisions include case-fold and overlapping selections", () => {
    const f = fixture(), plan = planDocumentNaming(f.root, f.request); writeFileSync(join(f.root, plan.documents[0]!.target.path.toUpperCase().replace("03_DRAFTY", "03_Drafty")), "external");
    expect(applyDocumentNaming(f.root, plan).status).toBe("conflict"); expect(() => planDocumentNaming(f.root, f.request)).toThrow();
    const g = fixture(); g.request.documents[1]!.metadata = { ...g.request.documents[0]!.metadata }; g.request.documents[1]!.path = "03_Drafty/another.pdf"; writeFileSync(join(g.root, "03_Drafty/another.pdf"), "a");
    expect(() => planDocumentNaming(g.root, g.request)).toThrow();
  });
  test("tampered exact plan, reused operation ID and incomplete journals fail closed", () => {
    const f = fixture(), plan = planDocumentNaming(f.root, f.request), altered = structuredClone(plan); altered.documents[0]!.target.path = "03_Drafty/evil.pdf";
    expect(() => parseNamingPlan(altered)).toThrow("fingerprint");
    const other = structuredClone(f.request); other.documents[0]!.metadata.description = "another"; const otherPlan = planDocumentNaming(f.root, other);
    expect(applyDocumentNaming(f.root, plan).status).toBe("applied"); expect(applyDocumentNaming(f.root, otherPlan).status).toBe("conflict");
    rmSync(join(f.root, ".lawoss/naming-history/op-1/committed.json")); expect(applyDocumentNaming(f.root, plan).status).toBe("recovery-required");
  });
  test("bounded reads, hardlinks, protected files and mapped memory files are rejected", () => {
    const f = fixture(); linkSync(join(f.root, "03_Drafty/old.PDF"), join(f.root, "03_Drafty/hard.pdf")); expect(() => planDocumentNaming(f.root, f.request)).toThrow("single-link");
    const g = fixture(); truncateSync(join(g.root, "03_Drafty/old.PDF"), NAMING_LIMITS.documentBytes + 1); expect(() => planDocumentNaming(g.root, g.request)).toThrow("limit");
    for (const path of ["MEMORY.md", "_memory.md", "spis.md", "PRACOVNY-PROFIL.md", ".lawoss/x.md", "memory/arbitrary.md"]) { const h = fixture(); h.request.documents[0]!.path = path; expect(() => planDocumentNaming(h.root, h.request)).toThrow(); }
    const h = fixture(); mkdirSync(join(h.root, ".lawoss")); writeFileSync(join(h.root, ".lawoss/memory-profile.json"), JSON.stringify({ version: 1, matterId: "matter", roots: [{ id: "local", path: "." }], sources: [{ id: "memory", root: "local", path: "03_Drafty/old.PDF", role: "case_memory", required: true, writable: true, anchors: ["matter"] }] }));
    expect(() => planDocumentNaming(h.root, h.request)).toThrow("Protected");
  });
  test("memory profile presence and physical matter identity pinned", () => {
    const f = fixture(), plan = planDocumentNaming(f.root, f.request); mkdirSync(join(f.root, ".lawoss")); writeFileSync(join(f.root, ".lawoss/memory-profile.json"), "{}"); expect(applyDocumentNaming(f.root, plan).status).toBe("conflict");
    const g = fixture(), plan2 = planDocumentNaming(g.root, g.request); renameSync(g.root, join(g.base, "old-root")); mkdirSync(g.root); expect(applyDocumentNaming(g.root, plan2).status).toBe("conflict");
  });
  test("fault after source removal rolls back bytes and links but retains recovery evidence", () => {
    const f = fixture(), before = tree(f.root), plan = planDocumentNaming(f.root, f.request);
    expect(applyDocumentNaming(f.root, plan, { checkpoint(stage) { if (stage === "source-removed") throw new Error("injected failure"); } }).status).toBe("recovery-required");
    for (const [path, sha] of Object.entries(before)) if (sha !== "directory") expect(hash(readFileSync(path))).toBe(sha);
    expect(existsSync(join(f.root, plan.documents[0]!.target.path))).toBe(false); expect(existsSync(join(f.root, ".lawoss/naming-history/op-1/failure.json"))).toBe(true);
    expect(applyDocumentNaming(f.root, plan).status).toBe("recovery-required");
  });
  test("rollback preserves newer external target and Markdown edits", () => {
    const f = fixture(), plan = planDocumentNaming(f.root, f.request);
    const result = applyDocumentNaming(f.root, plan, { checkpoint(stage, path) { if (stage === "markdown-installed") { writeFileSync(join(f.root, path!), "external newer note"); writeFileSync(join(f.root, plan.documents[0]!.target.path), "external newer binary"); throw new Error("failure after external edit"); } } });
    expect(result.status).toBe("recovery-required"); expect(readFileSync(join(f.root, "notes/note.md"), "utf8")).toBe("external newer note"); expect(readFileSync(join(f.root, plan.documents[0]!.target.path), "utf8")).toBe("external newer binary");
  });
  test.skipIf(!supportsSymlinks())("document, metadata and destination symlinks remain rejected: rename is not a symlink operation", () => {

    for (const path of ["03_Drafty/old.PDF", "notes/note.md", "03_Drafty", "notes"]) {
      const f = fixture(); renameSync(join(f.root, path), join(f.base, "moved")); symlinkSync(join(f.base, "moved"), join(f.root, path), path.includes(".") ? "file" : "dir"); expect(() => planDocumentNaming(f.root, f.request)).toThrow("Symlink");
    }
    const f = fixture(), plan = planDocumentNaming(f.root, f.request); symlinkSync(join(f.root, "03_Drafty/old.PDF"), join(f.root, plan.documents[0]!.target.path)); expect(applyDocumentNaming(f.root, plan).status).toBe("conflict");

  });
  test.skipIf(!supportsSymlinks())("root and ancestor aliases preserve physical pins, preview purity and apply/replay", () => {
    for (const ancestor of [false, true]) {
      const f = fixture(), alias = join(f.base, "alias");
      symlinkSync(ancestor ? f.base : f.root, alias, "dir");
      const selected = ancestor ? join(alias, "matter") : alias;
      const before = tree(f.root), direct = planDocumentNaming(f.root, f.request), plan = planDocumentNaming(selected, f.request);
      expect(plan).toEqual(direct); expect(tree(f.root)).toEqual(before);
      expect(plan.matterRootPhysical).toBe(f.root);
      expect(applyDocumentNaming(selected, plan).status).toBe("applied");
      for (const document of plan.documents) expect(readFileSync(join(f.root, document.target.path))).toEqual(f.binary);
      expect(applyDocumentNaming(selected, plan).status).toBe("already-applied");
    }
  });
  test.skipIf(!supportsSymlinks())("Node bundle accepts aliased root and external manifest/output parents", () => {
    const f = fixture(), alias = join(f.base, "alias"); symlinkSync(f.base, alias, "dir");
    const manifest = join(alias, "request.json"), planFile = join(alias, "plan.json");
    writeFileSync(manifest, JSON.stringify(f.request));
    const cli = fileURLToPath(new URL("../bundle/okf.js", import.meta.url));
    const invoke = (args: string[]) => spawnSync("node", [cli, "naming", join(alias, "matter"), ...args, "--json"], { encoding: "utf8" });
    const preview = invoke(["--manifest", manifest, "--out", planFile]);
    expect(preview.status).toBe(0);
    expect(JSON.parse(readFileSync(planFile, "utf8")).matterRootPhysical).toBe(f.root);
    expect(invoke(["--plan", planFile, "--apply"]).status).toBe(0);
    expect(invoke(["--plan", planFile, "--apply"]).status).toBe(0);
  });
  test.skipIf(!supportsSymlinks())("alias root never authorizes escaping or dangling destination parents; refusal has zero writes", () => {
    for (const dangling of [false, true]) {
      const f = fixture(), alias = join(f.base, "alias"); symlinkSync(f.root, alias, "dir");
      const plan = planDocumentNaming(alias, f.request);
      const outside = join(f.base, "outside");
      renameSync(join(f.root, "03_Drafty"), outside);
      symlinkSync(dangling ? join(outside, "missing") : outside, join(f.root, "03_Drafty"), "dir");
      const before = tree(f.base);
      expect(() => planDocumentNaming(alias, f.request)).toThrow();
      expect(applyDocumentNaming(alias, plan).status).toBe("conflict");
      expect(tree(f.base)).toEqual(before);
      expect(existsSync(join(f.root, ".lawoss"))).toBe(false);
    }
  });
  test("CLI preview/exact plan apply with external-only exclusive output and exit codes", () => {
    const f = fixture(), requestFile = join(f.base, "request.json"), planFile = join(f.base, "plan.json"), output: string[] = []; writeFileSync(requestFile, JSON.stringify(f.request));
    const before = tree(f.root); expect(run(["naming", f.root, "--manifest", requestFile, "--out", planFile, "--json"], s => output.push(s))).toBe(0); expect(tree(f.root)).toEqual(before);
    expect(JSON.parse(output[0]!).schema).toBe("lawoss.document-naming.plan/v1");
    expect(run(["naming", f.root, "--manifest", requestFile, "--apply"], () => {})).toBe(2);
    expect(run(["naming", f.root, "--manifest", requestFile, "--out", join(f.root, "plan.json")], () => {})).toBe(2);
    expect(run(["naming", f.root, "--manifest", requestFile, "--out", planFile], () => {})).toBe(1);
    expect(run(["naming", f.root, "--plan", planFile], () => {})).toBe(2);
    expect(run(["naming", f.root, "--plan", planFile, "--apply", "--json"], () => {})).toBe(0);
    expect(run(["naming", f.root, "--plan", planFile, "--apply"], () => {})).toBe(0);
    expect(run(["naming", f.root, "--plan", planFile, "--apply", "--force"], () => {})).toBe(2);
  });
  test("exclusive lock prevents concurrent apply and incomplete operation needs recovery", () => {
    const f = fixture(), plan = planDocumentNaming(f.root, f.request);
    mkdirSync(join(f.root, ".lawoss/naming-history"), { recursive: true }); writeFileSync(join(f.root, ".lawoss/naming-history/apply.lock"), "external lock");
    expect(applyDocumentNaming(f.root, plan).status).toBe("conflict"); expect(readFileSync(join(f.root, ".lawoss/naming-history/apply.lock"), "utf8")).toBe("external lock");
    expect(existsSync(join(f.root, plan.documents[0]!.target.path))).toBe(false);
    rmSync(join(f.root, ".lawoss/naming-history/apply.lock")); mkdirSync(join(f.root, ".lawoss/naming-history/op-1"));
    expect(applyDocumentNaming(f.root, plan).status).toBe("recovery-required");
  });
  test("late target appearance, source change and selected link change cannot commit", () => {
    for (const which of ["target", "source", "markdown"]) {
      const f = fixture(), plan = planDocumentNaming(f.root, f.request);
      const changed = which === "target" ? plan.documents[0]!.target.path : which === "source" ? plan.documents[0]!.source.path : "notes/note.md";
      const result = applyDocumentNaming(f.root, plan, { checkpoint(stage) { if (stage === "prepared") writeFileSync(join(f.root, changed), "concurrent edit"); } });
      expect(result.status).toBe("recovery-required"); expect(readFileSync(join(f.root, changed), "utf8")).toBe("concurrent edit");
    }
  });
  test("uncertain rollback keeps copies needed by newer links and never clobbers reappeared source", () => {
    const f = fixture(), plan = planDocumentNaming(f.root, f.request);
    const result = applyDocumentNaming(f.root, plan, { checkpoint(stage, path) { if (stage === "source-removed") { writeFileSync(join(f.root, path!), "newer source"); writeFileSync(join(f.root, "notes/note.md"), "newer link to working copy"); throw new Error("stop"); } } });
    expect(result.status).toBe("recovery-required"); expect(readFileSync(join(f.root, "03_Drafty/old.PDF"), "utf8")).toBe("newer source");
    expect(readFileSync(join(f.root, "notes/note.md"), "utf8")).toBe("newer link to working copy");
    for (const doc of plan.documents) expect(readFileSync(join(f.root, doc.target.path))).toEqual(f.binary);
  });
  test("committed replay rejects byte-identical physical replacement", () => {
    const f = fixture(), plan = planDocumentNaming(f.root, f.request); expect(applyDocumentNaming(f.root, plan).status).toBe("applied");
    const target = join(f.root, plan.documents[0]!.target.path); renameSync(target, `${target}.previous`); writeFileSync(target, f.binary);
    expect(applyDocumentNaming(f.root, plan).status).toBe("conflict");
  });
  test("custom saved roles and every placeholder determine target, source-target overlap refused", () => {
    const f = fixture(); mkdirSync(join(f.root, "Custom"));
    writeFileSync(join(f.root, "PRACOVNY-PROFIL.md"), renderWorkingProfile(workingProfile(["Custom"], { drafts: "Custom" }, "{kind}_{client}_{date}_{description}_{version}")));
    for (const d of f.request.documents) d.metadata = { ...d.metadata, kind: "Návrh", client: "Klient A" };
    expect(planDocumentNaming(f.root, f.request).documents[0]!.target.path).toBe("Custom/Návrh_Klient-A_2026-09-21_original_01.pdf");
    const g = fixture(); g.request.documents = [g.request.documents[1]!]; g.request.documents[0]!.metadata = { date: "bez-datumu", description: "working", version: "01" };
    g.request.documents[0]!.path = "03_Drafty/bez-datumu_working_v01.PDF"; renameSync(join(g.root, "03_Drafty/old.PDF"), join(g.root, g.request.documents[0]!.path));
    expect(() => planDocumentNaming(g.root, g.request)).toThrow("overlap");
  });
  test("real Node bundle preview, exact-plan apply and committed replay", () => {
    const f = fixture(), manifest = join(f.base, "request.json"), plan = join(f.base, "plan.json"); writeFileSync(manifest, JSON.stringify(f.request));
    const cli = fileURLToPath(new URL("../bundle/okf.js", import.meta.url));
    const invoke = (args: string[]) => spawnSync("node", [cli, "naming", f.root, ...args, "--json"], { encoding: "utf8" });
    const preview = invoke(["--manifest", manifest, "--out", plan]); expect(preview.status).toBe(0); expect(JSON.parse(preview.stdout).schema).toBe("lawoss.document-naming.plan/v1");
    const apply = invoke(["--plan", plan, "--apply"]); expect(apply.status).toBe(0); expect(JSON.parse(apply.stdout).status).toBe("applied");
    const replay = invoke(["--plan", plan, "--apply"]); expect(replay.status).toBe(0); expect(JSON.parse(replay.stdout).status).toBe("already-applied");
    expect(readFileSync(join(f.root, "01_Podklady/original.pdf"))).toEqual(f.binary);
  });

  test("review 5: truncated journal and committed receipt retain recovery evidence", () => {
    for (const record of ["journal.json", "committed.json"]) {
      const f = fixture(), plan = planDocumentNaming(f.root, f.request);
      expect(applyDocumentNaming(f.root, plan).status).toBe("applied");
      const path = join(f.root, ".lawoss/naming-history/op-1", record); writeFileSync(path, '{"version":1,');
      const before = tree(f.root), result = applyDocumentNaming(f.root, plan);
      expect(result.status).toBe("recovery-required"); expect(result.journal).toBe(join(f.root, ".lawoss/naming-history/op-1/journal.json"));
      expect(tree(f.root)).toEqual(before); expect(readFileSync(path, "utf8")).toBe('{"version":1,');
    }
  });
  test("review 1-3: filesystem refuses ambiguous selected links and applies exact reference destination", () => {
    for (const text of ['[x](../03_Drafty/old&#46;PDF)', '[[../03_Drafty/old.PDF#p2|label]]']) {
      const f = fixture(); f.request.documents[1]!.metadata.description = "A#B"; writeFileSync(join(f.root, "notes/note.md"), text);
      const before = tree(f.root); expect(() => planDocumentNaming(f.root, f.request)).toThrow(); expect(tree(f.root)).toEqual(before);
    }
    const f = fixture(); writeFileSync(join(f.root, "notes/note.md"), "[doc:../03_Drafty/old.PDF]: ../03_Drafty/old.PDF#p2");
    const plan = planDocumentNaming(f.root, f.request); expect(applyDocumentNaming(f.root, plan).status).toBe("applied");
    expect(readFileSync(join(f.root, "notes/note.md"), "utf8")).toBe("[doc:../03_Drafty/old.PDF]: ../03_Drafty/bez-datumu_working_v01.PDF#p2");
  });
  test("review 4-5: actual Node bundle distinguishes schema, fingerprint conflict and recovery", () => {
    const f = fixture(), manifest = join(f.base, "request.json"), planPath = join(f.base, "plan.json"); writeFileSync(manifest, JSON.stringify(f.request));
    const cli = fileURLToPath(new URL("../bundle/okf.js", import.meta.url));
    const invoke = (args: string[]) => spawnSync("node", [cli, "naming", f.root, ...args, "--json"], { encoding: "utf8" });
    expect(invoke(["--manifest", manifest, "--out", planPath]).status).toBe(0);
    const originalPlan = readFileSync(planPath, "utf8"), before = tree(f.root);
    const wrongSchema = join(f.base, "invalid-plan.json"); writeFileSync(wrongSchema, '{"wrong":"schema"}');
    expect(invoke(["--plan", wrongSchema, "--apply"]).status).toBe(2);
    writeFileSync(wrongSchema, '{'); expect(invoke(["--plan", wrongSchema, "--apply"]).status).toBe(2);
    const altered = JSON.parse(originalPlan); altered.documents[0].target.path = "03_Drafty/changed.pdf"; writeFileSync(wrongSchema, JSON.stringify(altered));
    expect(invoke(["--plan", wrongSchema, "--apply"]).status).toBe(1);
    expect(invoke(["--manifest", manifest, "--out", join(f.root, "plan.json")]).status).toBe(2);
    const invalidRequest = structuredClone(f.request); invalidRequest.documents[0]!.metadata.date = "2026-02-29"; writeFileSync(manifest, JSON.stringify(invalidRequest));
    expect(invoke(["--manifest", manifest]).status).toBe(2);
    invalidRequest.documents[0]!.metadata.date = "bez-datumu"; delete invalidRequest.documents[0]!.metadata.description; writeFileSync(manifest, JSON.stringify(invalidRequest));
    expect(invoke(["--manifest", manifest]).status).toBe(2);
    expect(tree(f.root)).toEqual(before);
    expect(invoke(["--plan", planPath, "--apply"]).status).toBe(0);
    const journal = join(f.root, ".lawoss/naming-history/op-1/journal.json"), savedJournal = readFileSync(journal);
    writeFileSync(journal, '{'); const badJournal = invoke(["--plan", planPath, "--apply"]);
    expect(badJournal.status).toBe(1); expect(JSON.parse(badJournal.stdout).status).toBe("recovery-required"); expect(JSON.parse(badJournal.stdout).journal).toBe(journal);
    writeFileSync(journal, savedJournal); writeFileSync(join(f.root, ".lawoss/naming-history/op-1/committed.json"), '{');
    const badReceipt = invoke(["--plan", planPath, "--apply"]); expect(badReceipt.status).toBe(1); expect(JSON.parse(badReceipt.stdout).status).toBe("recovery-required"); expect(JSON.parse(badReceipt.stdout).journal).toBe(journal);
  });

  test("review 5: complete different-fingerprint receipt stays conflict; invalid records need recovery", () => {
    const f = fixture(), plan = planDocumentNaming(f.root, f.request); expect(applyDocumentNaming(f.root, plan).status).toBe("applied");
    const receiptPath = join(f.root, ".lawoss/naming-history/op-1/committed.json"), receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    receipt.fingerprint = "0".repeat(64); writeFileSync(receiptPath, JSON.stringify(receipt));
    const before = tree(f.root); expect(applyDocumentNaming(f.root, plan).status).toBe("conflict"); expect(tree(f.root)).toEqual(before);
    writeFileSync(receiptPath, JSON.stringify({ version: 1, status: "committed", fingerprint: plan.fingerprint }));
    expect(applyDocumentNaming(f.root, plan).status).toBe("recovery-required");
    writeFileSync(join(f.root, ".lawoss/naming-history/op-1/journal.json"), '{}'); expect(applyDocumentNaming(f.root, plan).status).toBe("recovery-required");
  });

  test("review 1: angle link resolves to the actual special-character target after apply", () => {
    const f = fixture(); f.request.documents[1]!.metadata.description = "A#B%[C]";
    writeFileSync(join(f.root, "notes/note.md"), "[x](<../03_Drafty/old.PDF#p2>)");
    const plan = planDocumentNaming(f.root, f.request); expect(applyDocumentNaming(f.root, plan).status).toBe("applied");
    const name = "bez-datumu_A#B%[C]_v01.PDF";
    expect(readFileSync(join(f.root, "notes/note.md"), "utf8")).toBe(`[x](<../03_Drafty/${encodeURIComponent(name)}#p2>)`);
    expect(readFileSync(join(f.root, "03_Drafty", name))).toEqual(f.binary); expect(existsSync(join(f.root, "03_Drafty/old.PDF"))).toBe(false);
  });

  // Windows: dokument otvorený vo Worde sa nedá zmazať ani prepísať; zámok sa simuluje na každom OS.
  const locked = (path: string) => Object.assign(new Error(`EBUSY: resource busy or locked, unlink '${path}'`), { code: "EBUSY", path });
  const lockedMessage = (path: string) => `File is open in another program (for example Word) or is read-only: ${path}. Close it or allow writing, then create a new preview.`;
  const deniedMessage = (path: string, code: string) => `Access denied: ${path} (${code}). Check file and folder permissions, then create a new preview.`;
  test("lock preflight: a source open in another program is a conflict with zero writes", () => {
    const f = fixture(), plan = planDocumentNaming(f.root, f.request), before = tree(f.base), probed: string[] = [];
    const result = applyDocumentNaming(f.root, plan, { checkpoint(stage, path) { if (stage === "lock-probe") { probed.push(path!); if (path === "03_Drafty/old.PDF") throw locked(join(f.root, path)); } } });
    expect(result.status).toBe("conflict"); expect(result.rolledBack).toBeUndefined(); expect(result.journal).toBeUndefined();
    expect(result.message).toBe(lockedMessage("03_Drafty/old.PDF"));
    // Iba zdroje, ktoré apply zmaže alebo prepíše: pracovný dokument a Markdown so zmeneným odkazom, nie originál.
    expect(probed).toEqual(["03_Drafty/old.PDF"]);
    expect(tree(f.base)).toEqual(before); expect(existsSync(join(f.root, ".lawoss"))).toBe(false);
    const g = fixture(), gPlan = planDocumentNaming(g.root, g.request), gProbed: string[] = [];
    expect(applyDocumentNaming(g.root, gPlan, { checkpoint(stage, path) { if (stage === "lock-probe") { gProbed.push(path!); if (path === "notes/note.md") throw locked(join(g.root, path)); } } }).message).toBe(lockedMessage("notes/note.md"));
    expect(gProbed).toEqual(["03_Drafty/old.PDF", "notes/note.md"]);
    expect(applyDocumentNaming(g.root, gPlan).status).toBe("applied");
  });
  // Windows hlási otvorenie súboru „iba na čítanie“ na zápis ako EPERM. Root na Linuxe ho neodmietne, preto EPERM podá hook.
  const deniedOn = (platform: NodeJS.Platform, root: string, target: string) => ({ platform, checkpoint(stage: string, path?: string) { if (stage === "lock-probe" && path === target) throw Object.assign(new Error(`EPERM: operation not permitted, open '${join(root, target)}'`), { code: "EPERM", path: join(root, target) }); } });
  test("simulated Windows preflight: a read-only working document is renamed; a read-only Markdown or another denial stops with zero writes", () => {
    const f = fixture(), source = join(f.root, "03_Drafty/old.PDF"); chmodSync(source, 0o444);
    const plan = planDocumentNaming(f.root, f.request), working = plan.documents.find(d => d.id === "working")!;
    // Zmazanie zdroja potrebuje právo priečinka (libuv zruší atribút „iba na čítanie“), nie zápis do súboru.
    expect(applyDocumentNaming(f.root, plan, deniedOn("win32", f.root, "03_Drafty/old.PDF")).status).toBe("applied");
    expect(existsSync(source)).toBe(false); expect(readFileSync(join(f.root, working.target.path))).toEqual(f.binary);
    chmodSync(join(f.root, working.target.path), 0o644);
    // MoveFileEx nenahradí Markdown „iba na čítanie“: konflikt zámku. Zapisovateľný súbor s EPERM blokujú práva, nie Word.
    for (const [path, mode, message] of [["notes/note.md", 0o444, lockedMessage("notes/note.md")], ["notes/note.md", 0o644, deniedMessage("notes/note.md", "EPERM")], ["03_Drafty/old.PDF", 0o644, deniedMessage("03_Drafty/old.PDF", "EPERM")]] as const) {
      const g = fixture(); chmodSync(join(g.root, path), mode);
      const gPlan = planDocumentNaming(g.root, g.request), before = tree(g.base);
      const result = applyDocumentNaming(g.root, gPlan, deniedOn("win32", g.root, path));
      expect(result).toMatchObject({ status: "conflict", message }); expect(result.journal).toBeUndefined();
      expect(tree(g.base)).toEqual(before); expect(existsSync(join(g.root, ".lawoss"))).toBe(false);
      chmodSync(join(g.root, path), 0o644);
      // Na POSIX ten istý EPERM zámok nie je: zmazanie aj rename na miesto súboru potrebujú len právo priečinka.
      expect(applyDocumentNaming(g.root, gPlan, deniedOn("linux", g.root, path)).status).toBe("applied");
    }
  });
  // Skutočné O_RDWR na POSIX; root práva súboru obíde, preto beží len pod bežným používateľom (CI).
  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("POSIX: a read-only working document and Markdown apply as before; as on Windows only the Markdown stops", () => {
    const f = fixture(); for (const path of ["03_Drafty/old.PDF", "notes/note.md"]) chmodSync(join(f.root, path), 0o444);
    const plan = planDocumentNaming(f.root, f.request), working = plan.documents.find(d => d.id === "working")!, before = tree(f.base);
    expect(applyDocumentNaming(f.root, plan, { platform: "win32" })).toMatchObject({ status: "conflict", message: lockedMessage("notes/note.md") });
    expect(tree(f.base)).toEqual(before); expect(existsSync(join(f.root, ".lawoss"))).toBe(false);
    expect(applyDocumentNaming(f.root, plan).status).toBe("applied");
    expect(readFileSync(join(f.root, working.target.path))).toEqual(f.binary); expect(existsSync(join(f.root, "03_Drafty/old.PDF"))).toBe(false);
    expect(hash(readFileSync(join(f.root, "notes/note.md")))).toBe(plan.markdown[0]!.afterSha256);
    expect(lstatSync(join(f.root, "notes/note.md")).mode & 0o777).toBe(0o444);
  });
  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("POSIX: a folder without write permission is a neutral conflict after a complete rollback", () => {
    const f = fixture(), plan = planDocumentNaming(f.root, f.request), before = tree(f.root);
    chmodSync(join(f.root, "notes"), 0o555);
    try {
      const result = applyDocumentNaming(f.root, plan);
      expect(result).toMatchObject({ status: "conflict", rolledBack: true, message: deniedMessage("notes/note.md", "EACCES") });
      for (const [path, sha] of Object.entries(before)) if (sha !== "directory") expect(hash(readFileSync(path))).toBe(sha);
      for (const doc of plan.documents) expect(existsSync(join(f.root, doc.target.path))).toBe(false);
    } finally { chmodSync(join(f.root, "notes"), 0o755); }
  });
  test("a denial during the write names its cause: EBUSY or a read-only source on Windows is another program, other EPERM/EACCES is access", () => {
    const rename = (root: string, code: string) => Object.assign(new Error(`${code}: rename`), { code, path: join(root, ".lawoss/naming-history/op-1/markdown-0.stage"), dest: join(root, "notes/note.md") });
    const original = (root: string, code: string) => Object.assign(new Error(`${code}: open`), { code, path: join(root, "01_Podklady/original.pdf") });
    for (const [error, platform, message] of [
      [(root: string) => rename(root, "EACCES"), "linux", deniedMessage("notes/note.md", "EACCES")],
      [(root: string) => rename(root, "EPERM"), "win32", deniedMessage("notes/note.md", "EPERM")],
      [(root: string) => rename(root, "EBUSY"), "win32", lockedMessage("notes/note.md")],
      // Originál sa len číta: EBUSY znamená, že ho drží iný program (Outlook bez zdieľania), EACCES nie.
      [(root: string) => original(root, "EBUSY"), "linux", lockedMessage("01_Podklady/original.pdf")],
      [(root: string) => original(root, "EACCES"), "win32", deniedMessage("01_Podklady/original.pdf", "EACCES")],
    ] as const) {
      const f = fixture(), before = tree(f.root), plan = planDocumentNaming(f.root, f.request);
      const result = applyDocumentNaming(f.root, plan, { platform, checkpoint(stage) { if (stage === "target-created") throw error(f.root); } });
      expect(result).toMatchObject({ status: "conflict", rolledBack: true, message });
      for (const [path, sha] of Object.entries(before)) if (sha !== "directory") expect(hash(readFileSync(path))).toBe(sha);
    }
  });
  test("a lock after the first write rolls back completely and reports conflict, not recovery", () => {
    for (const stage of ["target-created", "markdown-installed"] as const) {
      const f = fixture(), before = tree(f.root), plan = planDocumentNaming(f.root, f.request);
      const result = applyDocumentNaming(f.root, plan, { checkpoint(current) { if (current === stage) throw locked(join(f.root, "03_Drafty/old.PDF")); } });
      expect(result).toMatchObject({ status: "conflict", rolledBack: true, journal: join(f.root, ".lawoss/naming-history/op-1/journal.json") });
      expect(result.message).toContain("03_Drafty/old.PDF");
      for (const [path, sha] of Object.entries(before)) if (sha !== "directory") expect(hash(readFileSync(path))).toBe(sha);
      for (const doc of plan.documents) expect(existsSync(join(f.root, doc.target.path))).toBe(false);
      expect(JSON.parse(readFileSync(join(f.root, ".lawoss/naming-history/op-1/failure.json"), "utf8")).status).toBe("rolled-back");
      // Rovnaké operationId už nesie journal: ďalší pokus potrebuje nový náhľad.
      expect(applyDocumentNaming(f.root, plan).status).toBe("recovery-required");
    }
    // Zámok záznamu v `.lawoss` nie je dokument advokáta a ostáva recovery-required.
    const g = fixture(), plan = planDocumentNaming(g.root, g.request);
    expect(applyDocumentNaming(g.root, plan, { checkpoint(stage) { if (stage === "target-created") throw locked(join(g.root, ".lawoss/naming-history/op-1/target-1.json")); } }).status).toBe("recovery-required");
  });
  test("lock rolled back only when every restoration succeeded", () => {
    const f = fixture(), plan = planDocumentNaming(f.root, f.request);
    const result = applyDocumentNaming(f.root, plan, { checkpoint(stage, path) { if (stage === "markdown-installed") { writeFileSync(join(f.root, path!), "external newer note"); throw locked(join(f.root, "03_Drafty/old.PDF")); } } });
    expect(result.status).toBe("recovery-required"); expect(result.rolledBack).toBeUndefined();
    expect(readFileSync(join(f.root, "notes/note.md"), "utf8")).toBe("external newer note");
  });
  test("rename retries only on Windows lock errors and stays bounded", () => {
    const busy = () => Object.assign(new Error("EBUSY"), { code: "EBUSY" });
    let calls = 0, waits = 0;
    renameWithRetry("a", "b", "win32", () => { if (++calls < 3) throw busy(); }, () => { waits++; });
    expect({ calls, waits }).toEqual({ calls: 3, waits: 2 });
    calls = 0; waits = 0;
    expect(() => renameWithRetry("a", "b", "win32", () => { calls++; throw busy(); }, () => { waits++; })).toThrow("EBUSY");
    expect({ calls, waits }).toEqual({ calls: 10, waits: 9 });
    calls = 0;
    expect(() => renameWithRetry("a", "b", "linux", () => { calls++; throw busy(); }, () => { throw new Error("no wait"); })).toThrow("EBUSY");
    expect(calls).toBe(1);
    calls = 0;
    expect(() => renameWithRetry("a", "b", "win32", () => { calls++; throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); }, () => { throw new Error("no wait"); })).toThrow("ENOENT");
    expect(calls).toBe(1);
  });
  // Skutočný zámok Windows: Word nechá dokument čítať (`Read`), zapisovať ani mazať nie; Outlook ani čítať (`None`).
  // Súbor so zámkom `None` nevie prečítať ani `tree()`, preto sa strom porovná až po uvoľnení zámku.
  for (const share of ["Read", "None"] as const) test.skipIf(process.platform !== "win32")(`Windows: a document held open (share ${share}) is a conflict with zero writes`, async () => {
    const f = fixture(), plan = planDocumentNaming(f.root, f.request), before = tree(f.base);
    const release = await holdWindowsFileLock(join(f.root, "03_Drafty/old.PDF"), share);
    try {
      const result = applyDocumentNaming(f.root, plan);
      expect(result.status).toBe("conflict"); expect(result.message).toBe("File is open in another program (for example Word) or is read-only: 03_Drafty/old.PDF. Close it or allow writing, then create a new preview.");
      expect(existsSync(join(f.root, ".lawoss"))).toBe(false);
    } finally { await release(); }
    expect(tree(f.base)).toEqual(before);
    expect(applyDocumentNaming(f.root, plan).status).toBe("applied");
  }, 60_000);

});
