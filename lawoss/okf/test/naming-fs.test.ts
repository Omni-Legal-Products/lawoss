import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, linkSync, truncateSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { planDocumentNaming, applyDocumentNaming, parseNamingPlan } from "../src/naming-fs.ts";
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
  test.skipIf(!supportsSymlinks())("symlink capability probe; sources, parents, targets, Markdown and root rejected", () => {

    for (const path of ["03_Drafty/old.PDF", "notes/note.md", "03_Drafty", "notes"]) {
      const f = fixture(); renameSync(join(f.root, path), join(f.base, "moved")); symlinkSync(join(f.base, "moved"), join(f.root, path), path.includes(".") ? "file" : "dir"); expect(() => planDocumentNaming(f.root, f.request)).toThrow("Symlink");
    }
    const f = fixture(), plan = planDocumentNaming(f.root, f.request); symlinkSync(join(f.root, "03_Drafty/old.PDF"), join(f.root, plan.documents[0]!.target.path)); expect(applyDocumentNaming(f.root, plan).status).toBe("conflict");
    symlinkSync(f.root, join(f.base, "root-link"), "dir"); expect(() => planDocumentNaming(join(f.base, "root-link"), f.request)).toThrow("Symlink");
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

});
