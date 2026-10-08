import { createHash } from "node:crypto";
import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp, mkdir, open, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectOnboardingRoot } from "../src/onboarding/classify.ts";
import { applyOnboarding, parseOnboardingRequest, planOnboarding } from "../src/onboarding/onboarding.ts";
import { applyTriagePlan, grantInPlaceReorganize, IN_PLACE_MARKER, prepareTriage, replanTriage, scanTriage, TriageConflictError, TrialCloneError, undoTriage, verifyTriageTarget } from "../src/triage/index.ts";
import { TRIAGE_FIXTURE, writeTriageFixture } from "./fixtures/triage-client.ts";

setDefaultTimeout(30_000);
const paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory(prefix: string) { const path = await realpath(await mkdtemp(join(tmpdir(), prefix))); paths.push(path); return path; }
const NOW = new Date("2026-10-08T10:00:00Z");

/** Skutočný klient po „convert“, ako ho urobí appka pri „Nie, len pridaj OKF súbory“. */
async function convertedClient(): Promise<string> {
  const base = await directory("okf-in-place-");
  const root = join(base, "Vymyslený klient");
  await mkdir(root);
  await writeTriageFixture(root, TRIAGE_FIXTURE);
  const preview = await planOnboarding(parseOnboardingRequest({ action: "existing", root, mode: "convert", title: "Vymyslený klient", clientType: "po", language: "sk", jurisdiction: "sk", date: "2026-10-08", confirmUnknownClient: true }));
  await applyOnboarding(preview, { journalDirectory: await directory("okf-journal-"), externalProfileDirectory: await directory("okf-external-") });
  return root;
}
async function documentsHash(root: string): Promise<string> {
  const inspection = await inspectOnboardingRoot(root);
  return createHash("sha256").update(JSON.stringify(inspection.entries.filter(entry => !entry.path.startsWith(".lawoss")))).digest("hex");
}

test("bez súhlasu sa klient mimo skúšobného klona neusporiada", async () => {
  const root = await convertedClient();
  await expect(verifyTriageTarget(root)).rejects.toBeInstanceOf(TrialCloneError);
  await expect(prepareTriage(root, { now: NOW })).rejects.toThrow(/súhlas/);
});

test("súhlas vyžaduje kartu klienta a je idempotentný", async () => {
  const plain = await directory("okf-in-place-plain-");
  await expect(grantInPlaceReorganize(plain, NOW)).rejects.toThrow(/klienta/);
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  await grantInPlaceReorganize(root, NOW);
  expect(JSON.parse(await readFile(join(root, IN_PLACE_MARKER), "utf8"))).toEqual({ version: 1, root, grantedAt: NOW.toISOString() });
  expect(await verifyTriageTarget(root)).toEqual({ root, mode: "in_place", journalVerified: false });
});

test("súhlas z iného priečinka (skopírovaný marker) neplatí", async () => {
  const root = await convertedClient();
  await mkdir(join(root, ".lawoss"), { recursive: true });
  await writeFile(join(root, IN_PLACE_MARKER), JSON.stringify({ version: 1, root: "/iny/priecinok", grantedAt: NOW.toISOString() }));
  await expect(verifyTriageTarget(root)).rejects.toThrow(/súhlas/);
});

test("usporiadanie na mieste a jeho úplné vrátenie", async () => {
  const root = await convertedClient();
  const before = await documentsHash(root);
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW });
  expect(plan.moves.length).toBeGreaterThan(0);
  const applied = await applyTriagePlan(plan);
  expect(applied).toMatchObject({ status: "applied", moved: plan.moves.length });
  expect(await documentsHash(root)).not.toBe(before);
  const undone = await undoTriage(root, plan.runId);
  expect(undone.status).toBe("undone");
  expect(await documentsHash(root)).toBe(before);
  expect(await readdir(join(root, ".lawoss"))).toContain("reorganize.json");
});

/** Zámok simulovaný chybou EBUSY pri otvorení súboru (Word na Windows). */
function lockHooks(locked: string) {
  return {
    open: (async (path: Parameters<typeof open>[0], flags?: string | number) => {
      if (String(path).endsWith(locked)) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      return open(path, flags);
    }) as typeof open,
  };
}
const LOCKED_DOCX = "Zmluva_o_dielo_v2.docx";

test("zamknutý súbor sa preskočí a nahlási, ostatné sa usporiadajú", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const locked = Object.keys(TRIAGE_FIXTURE).find(path => path.endsWith(".docx"));
  if (!locked) throw new Error("Fixture needs a .docx document.");
  const hooks = {
    open: (async (path: Parameters<typeof open>[0], flags?: string | number) => {
      if (String(path).endsWith(locked)) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      return open(path, flags);
    }) as typeof open,
  };
  const inventory = await scanTriage(root, { hooks });
  expect(inventory.skipped).toContainEqual({ path: locked, reason: "locked" });
  expect(inventory.documents.some(document => document.path === locked)).toBe(false);
});

test("súbor zamknutý aj pri zápise nezablokuje zápis a nepresunie sa", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const before = await readFile(join(root, LOCKED_DOCX));
  const hooks = lockHooks(LOCKED_DOCX);
  const inventory = await scanTriage(root, { hooks });
  const plan = replanTriage(inventory, undefined, [], NOW);
  expect(plan.moves.length).toBeGreaterThan(0);
  expect(plan.moves.some(move => move.from === LOCKED_DOCX)).toBe(false);
  const applied = await applyTriagePlan(plan, { hooks });
  expect(applied).toMatchObject({ status: "applied", moved: plan.moves.length });
  expect(Buffer.compare(await readFile(join(root, LOCKED_DOCX)), before)).toBe(0);
  for (const move of plan.moves) expect((await readFile(join(root, move.to))).length).toBeGreaterThan(0);
});

test("súbor zamknutý pri náhľade a odomknutý pri zápise vyžiada nový náhľad", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const inventory = await scanTriage(root, { hooks: lockHooks(LOCKED_DOCX) });
  const plan = replanTriage(inventory, undefined, [], NOW);
  await expect(applyTriagePlan(plan)).rejects.toBeInstanceOf(TriageConflictError);
});

test("zamknutý súbor spolu s iným problémom inšpekcie stále zastaví náhľad", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  await symlink(join(root, LOCKED_DOCX), join(root, "odkaz.docx"));
  await expect(scanTriage(root, { hooks: lockHooks(LOCKED_DOCX) })).rejects.toThrow(/symbolick|nepodarilo prečítať/);
});

test("vrátenie s keepChanged ponechá upravený dokument a ostatné vráti", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW });
  expect(plan.moves.length).toBeGreaterThan(1);
  await applyTriagePlan(plan);
  const changed = plan.moves[0]!;
  await writeFile(join(root, changed.to), "advokát to medzitým upravil");
  await expect(undoTriage(root, plan.runId)).rejects.toThrow(/zmenených/);
  const result = await undoTriage(root, plan.runId, { keepChanged: true });
  expect(result).toMatchObject({ status: "undone", restored: plan.moves.length - 1 });
  expect(result.kept).toContain(changed.to);
  expect(await readFile(join(root, changed.to), "utf8")).toBe("advokát to medzitým upravil");
  for (const move of plan.moves.slice(1)) await expect(readFile(join(root, move.from))).resolves.toBeDefined();
});

test("bez keepChanged ostáva vrátenie všetko alebo nič a nič nezmení", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW });
  await applyTriagePlan(plan);
  await writeFile(join(root, plan.moves[0]!.to), "zmena");
  const before = await documentsHash(root);
  await expect(undoTriage(root, plan.runId)).rejects.toThrow();
  expect(await documentsHash(root)).toBe(before);
});
