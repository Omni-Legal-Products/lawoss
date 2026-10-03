import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planClientConversion, readInspectedText } from "../src/onboarding/plan.ts";
import { inspectOnboardingRoot } from "../src/onboarding/classify.ts";
import { PROFILE_FILE, renderWorkingProfile, workingProfile } from "../src/profile.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() { const root = await realpath(await mkdtemp(join(tmpdir(), "okf-onboarding-plan-"))); roots.push(root); return root; }
const input = { title: "Synthetic client", clientType: "po", language: "sk", jurisdiction: "sk", date: "2026-10-03", confirmUnknownClient: true } as const;

for (const clientType of ["po", "fo", "fo-podnikatel"] as const) test(`client conversion ${clientType} is read-only and deterministic`, async () => {
  const root = await fixture();
  await writeFile(join(root, "original.txt"), "Original bytes\n");
  await writeFile(join(root, "MEMORY.md"), "Historic memory\n");
  const before = await inspectOnboardingRoot(root);
  if (!before.digest) throw new Error("Fixture inspection failed.");
  const preview = await planClientConversion(root, { ...input, clientType });
  expect(preview).toEqual(await planClientConversion(root, { ...input, clientType }));
  expect(before.digest).not.toBeNull();
  expect(preview.plan.treeDigest).toEqual(before.digest);
  expect(preview.plan.operations.some(op => op.path === "original.txt" || op.path === "MEMORY.md")).toBe(false);
  expect(preview.archiveSources).toContain("MEMORY.md");
  expect(preview.plan.operations.find(op => op.path === "client.md")?.content).toContain(`client_type: ${clientType}`);
  expect(preview.plan.operations.find(op => op.path === "memory")?.kind).toBe("directory");
  expect((await inspectOnboardingRoot(root)).digest).toBe(before.digest);
});

test("an existing alias card and original instruction text are retained", async () => {
  const root = await fixture();
  await writeFile(join(root, "klient.md"), "---\ntype: klient\ntitle: Original\n---\n");
  await writeFile(join(root, "CLAUDE.md"), "Original instructions\n");
  const preview = await planClientConversion(root, { ...input, confirmUnknownClient: false });
  expect(preview.plan.operations.some(op => ["client.md", "klient.md", "CLAUDE.md"].includes(op.path))).toBe(false);
  expect(preview.plan.operations.find(op => op.path === "AGENTS.md")?.content).toBe("Original instructions\n");
  expect(await readFile(join(root, "klient.md"), "utf8")).toContain("Original");
});

test("office, matter, ambiguous and unconfirmed directories cannot become clients", async () => {
  for (const card of [null, "matter.md", "Office/okf.config"]) {
    const root = await fixture();
    if (card === "Office/okf.config") await mkdir(join(root, "Office"));
    if (card) await writeFile(join(root, card), "---\ntype: spis\n---\n");
    await expect(planClientConversion(root, { ...input, confirmUnknownClient: card !== null })).rejects.toThrow();
  }
});

test("conflicting instruction mirrors and file/directory collisions stop planning", async () => {
  const root = await fixture();
  await writeFile(join(root, "AGENTS.md"), "a"); await writeFile(join(root, "CLAUDE.md"), "b");
  await expect(planClientConversion(root, input)).rejects.toThrow("differ");
  await writeFile(join(root, "CLAUDE.md"), "a"); await writeFile(join(root, "memory"), "foreign file");
  await expect(planClientConversion(root, input)).rejects.toThrow("blocks");
});

test("instruction reads reject changed bytes and links substituted after inspection", async () => {
  const root = await fixture(), outside = await fixture();
  await writeFile(join(root, "AGENTS.md"), "Original instructions\n");
  const entry = (await inspectOnboardingRoot(root)).entries.find(entry => entry.path === "AGENTS.md");
  if (!entry) throw new Error("Missing fixture instruction.");
  await writeFile(join(root, "AGENTS.md"), "Modified instructions\n");
  await expect(readInspectedText(root, entry)).rejects.toThrow("changed");
  await writeFile(join(outside, "secret.txt"), "Original instructions\n");
  await rm(join(root, "AGENTS.md"));
  try { await symlink(join(outside, "secret.txt"), join(root, "AGENTS.md")); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && ["EPERM", "EACCES", "ENOSYS"].includes(String(error.code))) return;
    throw error;
  }
  await expect(readInspectedText(root, entry)).rejects.toThrow();
  expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("Original instructions\n");
});

test("conversion follows the existing working profile and refuses a broken one", async () => {
  const root = await fixture();
  const profile = renderWorkingProfile(workingProfile(["Client inbox", "Deliverables"], { inbox: "Client inbox", outputs: "Deliverables" }));
  await writeFile(join(root, PROFILE_FILE), profile);
  const preview = await planClientConversion(root, input);
  expect(preview.plan.operations.some(op => op.path === "Client inbox/.keep")).toBe(true);
  expect(preview.plan.operations.some(op => op.path.startsWith("00_Na_zatriedenie"))).toBe(false);
  expect(preview.plan.operations.some(op => op.path === PROFILE_FILE)).toBe(false);
  await writeFile(join(root, PROFILE_FILE), "Broken profile");
  await expect(planClientConversion(root, input)).rejects.toThrow();
});

test("an instruction mirror preserves UTF-8 BOM and CRLF bytes", async () => {
  const root = await fixture(), original = "\uFEFFOriginal instructions\r\n";
  await writeFile(join(root, "AGENTS.md"), original);
  const preview = await planClientConversion(root, input);
  expect(preview.plan.operations.find(operation => operation.path === "CLAUDE.md")?.content).toBe(original);
});
