import { afterEach, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectOnboardingParent } from "../src/onboarding/classify.ts";
import { applyOnboarding, parseOnboardingRequest, planOnboarding } from "../src/onboarding/onboarding.ts";
import { planClientConversion, planShallowClientConversion } from "../src/onboarding/plan.ts";

/**
 * „Nie, len pridaj OKF súbory“ (convert) na skutočnom priečinku klienta: plán stojí na plytkej
 * kontrole najvyššej úrovne, takže symbolický odkaz či veľký strom v podpriečinku ho nezastaví,
 * a nikdy nenavrhne vytvoriť niečo, čo už existuje.
 */
const paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory(prefix: string) { const path = await realpath(await mkdtemp(join(tmpdir(), prefix))); paths.push(path); return path; }
const input = { title: "Vymyslený klient", clientType: "po", language: "sk", jurisdiction: "sk", date: "2026-10-08", confirmUnknownClient: true } as const;
const request = (root: string) => parseOnboardingRequest({ action: "existing", root, mode: "convert", ...input });
const options = async () => ({ journalDirectory: await directory("okf-shallow-journal-"), externalProfileDirectory: await directory("okf-shallow-external-") });
const exists = (path: string) => lstat(path).then(() => true, () => false);

/** Priečinok klienta s dokumentom a symbolickým odkazom v podpriečinku (bežné na Windows aj macOS). */
async function clientWithLink(): Promise<{ root: string; outside: string; linked: boolean }> {
  const root = await directory("okf-shallow-client-"), outside = await directory("okf-shallow-outside-");
  await mkdir(join(root, "Zmluvy"));
  await writeFile(join(root, "Zmluvy", "zmluva.pdf"), "zmluva");
  await writeFile(join(outside, "cudzi.txt"), "cudzí súbor");
  try { await symlink(join(outside, "cudzi.txt"), join(root, "Zmluvy", "odkaz.txt")); return { root, outside, linked: true }; }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && ["EPERM", "EACCES", "ENOSYS"].includes(String(error.code))) return { root, outside, linked: false };
    throw error;
  }
}

test("convert pri symbolickom odkaze v podpriečinku pridá OKF súbory a podpriečinok nechá tak", async () => {
  const { root, outside, linked } = await clientWithLink();
  if (linked) await expect(planClientConversion(root, input)).rejects.toThrow("symlink_not_followed");
  const preview = await planOnboarding(request(root));
  if (preview.mode !== "new") throw new Error("Convert must return a create preview.");
  expect(preview.plan.scope).toBe("parent");
  expect(preview.plan.treeDigest).toBe((await inspectOnboardingParent(root)).digest ?? "");
  expect(preview.plan.operations.some(operation => operation.path.startsWith("Zmluvy"))).toBe(false);
  await applyOnboarding(preview, await options());
  for (const name of ["AGENTS.md", "CLAUDE.md", "client.md", "MEMORY.md", "memory"]) expect(await exists(join(root, name))).toBe(true);
  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(await readFile(join(root, "CLAUDE.md"), "utf8"));
  expect(await readFile(join(root, "Zmluvy", "zmluva.pdf"), "utf8")).toBe("zmluva");
  if (linked) {
    expect((await lstat(join(root, "Zmluvy", "odkaz.txt"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(root, "Zmluvy", "odkaz.txt"))).toBe(join(outside, "cudzi.txt"));
  }
  expect(await readFile(join(outside, "cudzi.txt"), "utf8")).toBe("cudzí súbor");
});

test("existujúca pamäť a priečinky s obsahom: plán nič existujúce nezakladá a zápis prejde", async () => {
  const { root } = await clientWithLink();
  await mkdir(join(root, "memory"));
  await writeFile(join(root, "memory", "poznamky.md"), "advokátove poznámky");
  await mkdir(join(root, "Spisy"));
  await writeFile(join(root, "Spisy", ".keep"), "");
  await mkdir(join(root, "05_Komunikacia"));
  await writeFile(join(root, "05_Komunikacia", ".keep"), "advokátov obsah");
  const preview = await planOnboarding(request(root));
  if (preview.mode !== "new") throw new Error("Convert must return a create preview.");
  expect(preview.plan.scope).toBe("parent");
  for (const operation of preview.plan.operations) expect(await exists(join(root, operation.path))).toBe(false);
  const planned = preview.plan.operations.map(operation => operation.path);
  expect(planned).toContain("00_Na_zatriedenie/.keep");
  expect(planned.filter(path => ["memory", "Spisy", "Spisy/.keep", "05_Komunikacia", "05_Komunikacia/.keep"].includes(path))).toEqual([]);
  await applyOnboarding(preview, await options());
  expect(await readFile(join(root, "memory", "poznamky.md"), "utf8")).toBe("advokátove poznámky");
  expect(await readFile(join(root, "05_Komunikacia", ".keep"), "utf8")).toBe("advokátov obsah");
  expect(await exists(join(root, "00_Na_zatriedenie", ".keep"))).toBe(true);
});

test("existujúci AGENTS.md sa nezmení a CLAUDE.md je jeho presná kópia", async () => {
  const { root } = await clientWithLink();
  const original = "﻿Pravidlá advokáta\r\n";
  await writeFile(join(root, "AGENTS.md"), original);
  const preview = await planOnboarding(request(root));
  if (preview.mode !== "new") throw new Error("Convert must return a create preview.");
  expect(preview.plan.operations.some(operation => operation.path === "AGENTS.md")).toBe(false);
  expect(preview.plan.operations.find(operation => operation.path === "CLAUDE.md")?.content).toBe(original);
  await applyOnboarding(preview, await options());
  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(original);
  expect(await readFile(join(root, "CLAUDE.md"), "utf8")).toBe(original);
});

test("rozdielne AGENTS.md a CLAUDE.md zastavia plán", async () => {
  const { root } = await clientWithLink();
  await writeFile(join(root, "AGENTS.md"), "a");
  await writeFile(join(root, "CLAUDE.md"), "b");
  await expect(planOnboarding(request(root))).rejects.toThrow("AGENTS.md and CLAUDE.md differ");
});

test("plytký plán vráti zachované súbory, zdroje pamäte a rovnaké operácie ako plný plán", async () => {
  const root = await directory("okf-shallow-same-");
  await writeFile(join(root, "MEMORY.md"), "stará pamäť");
  await writeFile(join(root, "zmluva.pdf"), "zmluva");
  await mkdir(join(root, ".lawoss"));
  await writeFile(join(root, ".lawoss", "memory-profile.json"), "{}");
  await mkdir(join(root, "Zmluvy"));
  await writeFile(join(root, "Zmluvy", "dodatok.pdf"), "dodatok");
  const full = await planClientConversion(root, input), shallow = await planShallowClientConversion(root, input);
  expect(shallow.plan.operations).toEqual(full.plan.operations);
  expect(shallow.archiveSources).toEqual(full.archiveSources);
  expect(shallow.archiveSources).toEqual([".lawoss/memory-profile.json", "MEMORY.md"]);
  expect(shallow.preserved).toEqual(["MEMORY.md", "zmluva.pdf"]);
  expect(shallow.plan).toMatchObject({ version: 1, root, scope: "parent", treeDigest: (await inspectOnboardingParent(root)).digest ?? "" });
});

test("plytký plán odmietne nie klienta, rozpor kariet, blokujúce položky a nebezpečné inštrukcie", async () => {
  const matter = await directory("okf-shallow-matter-");
  await writeFile(join(matter, "matter.md"), "---\ntype: matter\n---\n");
  await expect(planShallowClientConversion(matter, input)).rejects.toThrow("Select a client directory");
  const unconfirmed = await directory("okf-shallow-unconfirmed-");
  await expect(planShallowClientConversion(unconfirmed, { ...input, confirmUnknownClient: false })).rejects.toThrow("Select a client directory");
  const conflict = await directory("okf-shallow-conflict-");
  await writeFile(join(conflict, "client.md"), "---\ntype: client\n---\n");
  await writeFile(join(conflict, "matter.md"), "---\ntype: matter\n---\n");
  await expect(planShallowClientConversion(conflict, input)).rejects.toThrow("could not be inspected completely and unambiguously");

  const fileBlocks = await directory("okf-shallow-file-blocks-");
  await writeFile(join(fileBlocks, "Spisy"), "advokátov súbor");
  await expect(planShallowClientConversion(fileBlocks, input)).rejects.toThrow("A file blocks the planned directory: Spisy");
  const directoryBlocks = await directory("okf-shallow-dir-blocks-");
  await mkdir(join(directoryBlocks, "Spisy", ".keep"), { recursive: true });
  await expect(planShallowClientConversion(directoryBlocks, input)).rejects.toThrow("A directory blocks the planned file: Spisy/.keep");

  const large = await directory("okf-shallow-large-");
  await writeFile(join(large, "AGENTS.md"), "x".repeat(1024 * 1024 + 1));
  await expect(planShallowClientConversion(large, input)).rejects.toThrow("size limit");
  const invalid = await directory("okf-shallow-invalid-");
  await writeFile(join(invalid, "AGENTS.md"), Buffer.from([0xff, 0xfe, 0x00, 0xd8]));
  await expect(planShallowClientConversion(invalid, input)).rejects.toThrow();
  const { root, outside, linked } = await clientWithLink();
  if (linked) {
    await symlink(join(outside, "cudzi.txt"), join(root, "AGENTS.md"));
    await expect(planShallowClientConversion(root, input)).rejects.toThrow("size limit");
    const linkedDirectory = await directory("okf-shallow-linked-dir-");
    await symlink(outside, join(linkedDirectory, "Spisy"));
    await expect(planShallowClientConversion(linkedDirectory, input)).rejects.toThrow("A file blocks the planned directory: Spisy");
    expect(await readFile(join(outside, "cudzi.txt"), "utf8")).toBe("cudzí súbor");
  }
});
