import { createHash } from "node:crypto";
import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { chmod, mkdtemp, mkdir, open, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectOnboardingRoot } from "../src/onboarding/classify.ts";
import { applyOnboarding, parseOnboardingRequest, planOnboarding } from "../src/onboarding/onboarding.ts";
import { applyTriagePlan, grantInPlaceReorganize, IN_PLACE_MARKER, prepareTriage, replanTriage, scanTriage, TriageConflictError, TrialCloneError, undoTriage, verifyTriageTarget } from "../src/triage/index.ts";
import { TRIAGE_FIXTURE, writeTriageFixture } from "./fixtures/triage-client.ts";
import { holdWindowsFileLock } from "./windows-file-lock.ts";

setDefaultTimeout(30_000);
const paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory(prefix: string) { const path = await realpath(await mkdtemp(join(tmpdir(), prefix))); paths.push(path); return path; }
const NOW = new Date("2026-10-08T10:00:00Z");
/** Hostiteľ, ktorý súhlas s usporiadaním na mieste overil vlastným záznamom (C1); bez toho sa originál odmietne. */
const HOST = { allowInPlace: true } as const;

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
  await expect(verifyTriageTarget(root, undefined, HOST)).rejects.toBeInstanceOf(TrialCloneError);
  await expect(prepareTriage(root, { now: NOW, ...HOST })).rejects.toThrow(/súhlas/);
});

test("súhlas vyžaduje kartu klienta a je idempotentný", async () => {
  const plain = await directory("okf-in-place-plain-");
  await expect(grantInPlaceReorganize(plain, NOW)).rejects.toThrow(/klienta/);
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  await grantInPlaceReorganize(root, NOW);
  expect(JSON.parse(await readFile(join(root, IN_PLACE_MARKER), "utf8"))).toEqual({ version: 1, root, grantedAt: NOW.toISOString() });
  expect(await verifyTriageTarget(root, undefined, HOST)).toEqual({ root, mode: "in_place", journalVerified: false });
});

test("súhlas dostane aj klient so symbolickým odkazom a veľkým dokumentom v podpriečinku", async () => {
  const root = await convertedClient(), outside = await directory("okf-in-place-outside-");
  await writeFile(join(outside, "cudzi.txt"), "cudzí súbor");
  await mkdir(join(root, "Archiv"));
  try { await symlink(join(outside, "cudzi.txt"), join(root, "Archiv", "odkaz.txt")); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && ["EPERM", "EACCES", "ENOSYS"].includes(String(error.code)))) throw error; }
  // Riedky súbor nad limit 1 GB: plná inšpekcia skončí skôr, než sa dostane ku karte klienta.
  const large = await open(join(root, "Archiv", "zaloha.bin"), "w");
  try { await large.truncate(1024 * 1024 * 1024 + 1); } finally { await large.close(); }
  await grantInPlaceReorganize(root, NOW);
  expect(JSON.parse(await readFile(join(root, IN_PLACE_MARKER), "utf8"))).toEqual({ version: 1, root, grantedAt: NOW.toISOString() });
  expect(await readFile(join(outside, "cudzi.txt"), "utf8")).toBe("cudzí súbor");
});

test("súhlas z iného priečinka (skopírovaný marker) neplatí", async () => {
  const root = await convertedClient();
  await mkdir(join(root, ".lawoss"), { recursive: true });
  await writeFile(join(root, IN_PLACE_MARKER), JSON.stringify({ version: 1, root: "/iny/priecinok", grantedAt: NOW.toISOString() }));
  await expect(verifyTriageTarget(root, undefined, HOST)).rejects.toThrow(/súhlas/);
});

test("ručne zapísaná značka bez povolenia hostiteľa neotvorí originál pre náhľad, zápis ani vrátenie", async () => {
  const root = await convertedClient();
  await mkdir(join(root, ".lawoss"), { recursive: true });
  // Značku vie zapísať ktokoľvek s prístupom k priečinku, aj agent; súhlasom nie je.
  await writeFile(join(root, IN_PLACE_MARKER), JSON.stringify({ version: 1, root, grantedAt: "hocičo" }));
  const before = await documentsHash(root);
  await expect(verifyTriageTarget(root)).rejects.toBeInstanceOf(TrialCloneError);
  await expect(scanTriage(root)).rejects.toBeInstanceOf(TrialCloneError);
  await expect(prepareTriage(root, { now: NOW })).rejects.toBeInstanceOf(TrialCloneError);
  // Plán a beh, ktoré pripravil hostiteľ po overení súhlasu, sa bez povolenia nepoužijú.
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  expect(plan.moves.length).toBeGreaterThan(0);
  await expect(applyTriagePlan(plan)).rejects.toBeInstanceOf(TrialCloneError);
  expect(await documentsHash(root)).toBe(before);
  await applyTriagePlan(plan, HOST);
  const applied = await documentsHash(root);
  await expect(undoTriage(root, plan.runId)).rejects.toBeInstanceOf(TrialCloneError);
  expect(await documentsHash(root)).toBe(applied);
});

test("usporiadanie na mieste a jeho úplné vrátenie", async () => {
  const root = await convertedClient();
  const before = await documentsHash(root);
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  expect(plan.moves.length).toBeGreaterThan(0);
  const applied = await applyTriagePlan(plan, HOST);
  expect(applied).toMatchObject({ status: "applied", moved: plan.moves.length });
  expect(await documentsHash(root)).not.toBe(before);
  const undone = await undoTriage(root, plan.runId, HOST);
  expect(undone.status).toBe("undone");
  expect(await documentsHash(root)).toBe(before);
  expect(await readdir(join(root, ".lawoss"))).toContain("reorganize.json");
});

test("priečinok veci bez karty (`2025-01 Spor`) sa nerozpustí, ostatné podpriečinky sa usporiadajú", async () => {
  const root = await convertedClient();
  await mkdir(join(root, "2025-01 Spor"));
  await writeFile(join(root, "2025-01 Spor", "Žaloba.pdf"), "%PDF-1.4 synthetic claim in matter");
  await grantInPlaceReorganize(root, NOW);
  const inventory = await scanTriage(root, HOST);
  expect(inventory.skipped).toContainEqual({ path: "2025-01 Spor/Žaloba.pdf", reason: "in_matter" });
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  expect(plan.moves.some(move => move.from.startsWith("2025-01 Spor/"))).toBe(false);
  expect(plan.moves.some(move => move.from === "Stare/priloha.pdf")).toBe(true);
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
  const inventory = await scanTriage(root, { hooks, ...HOST });
  expect(inventory.skipped).toContainEqual({ path: locked, reason: "locked" });
  expect(inventory.documents.some(document => document.path === locked)).toBe(false);
});

test("súbor zamknutý aj pri zápise nezablokuje zápis a nepresunie sa", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const before = await readFile(join(root, LOCKED_DOCX));
  const hooks = lockHooks(LOCKED_DOCX);
  const inventory = await scanTriage(root, { hooks, ...HOST });
  const plan = replanTriage(inventory, undefined, [], NOW);
  expect(plan.moves.length).toBeGreaterThan(0);
  expect(plan.moves.some(move => move.from === LOCKED_DOCX)).toBe(false);
  const applied = await applyTriagePlan(plan, { hooks, ...HOST });
  expect(applied).toMatchObject({ status: "applied", moved: plan.moves.length });
  expect(Buffer.compare(await readFile(join(root, LOCKED_DOCX)), before)).toBe(0);
  for (const move of plan.moves) expect((await readFile(join(root, move.to))).length).toBeGreaterThan(0);
});

test("súbor zamknutý pri náhľade a odomknutý pri zápise vyžiada nový náhľad", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const inventory = await scanTriage(root, { hooks: lockHooks(LOCKED_DOCX), ...HOST });
  const plan = replanTriage(inventory, undefined, [], NOW);
  await expect(applyTriagePlan(plan, HOST)).rejects.toBeInstanceOf(TriageConflictError);
});

test("zamknutý súbor spolu s iným problémom inšpekcie stále zastaví náhľad", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  await symlink(join(root, LOCKED_DOCX), join(root, "odkaz.docx"));
  await expect(scanTriage(root, { hooks: lockHooks(LOCKED_DOCX), ...HOST })).rejects.toThrow(/symbolick|nepodarilo prečítať/);
});

/**
 * Word na Windows: dokument sa dá otvoriť na čítanie, nie na zápis ani zmazanie. Sonda zápisu
 * (na win32 open s O_RDWR) sa simuluje chybou `code` len pre súbory z `locked`; čítanie ide ďalej.
 */
function wordHooks(locked: readonly string[], code = "EBUSY") {
  return { writeProbe: async (path: string) => { if (locked.some(name => path.endsWith(name))) throw Object.assign(new Error("locked for write"), { code }); } };
}

test("dokument otvorený vo Worde (čítanie áno, zápis nie) sa v náhľade preskočí ako locked", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const inventory = await scanTriage(root, { hooks: wordHooks([LOCKED_DOCX]), ...HOST });
  expect(inventory.skipped).toContainEqual({ path: LOCKED_DOCX, reason: "locked" });
  expect(inventory.documents.some(document => document.path === LOCKED_DOCX)).toBe(false);
  const plan = replanTriage(inventory, undefined, [], NOW);
  expect(plan.moves.length).toBeGreaterThan(0);
  expect(plan.moves.some(move => move.from === LOCKED_DOCX)).toBe(false);
  expect(await applyTriagePlan(plan, { hooks: wordHooks([LOCKED_DOCX]), ...HOST })).toMatchObject({ status: "applied", moved: plan.moves.length });
  await expect(readFile(join(root, LOCKED_DOCX))).resolves.toBeDefined();
});

test("dokument otvorený vo Worde až po náhľade zastaví zápis pred prvým presunom", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  expect(plan.moves.some(move => move.from === LOCKED_DOCX)).toBe(true);
  const before = await documentsHash(root);
  const error = await applyTriagePlan(plan, { hooks: wordHooks([LOCKED_DOCX]), ...HOST }).then(() => undefined, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(TriageConflictError);
  expect(error instanceof Error ? error.message : "").toContain(LOCKED_DOCX);
  expect(error instanceof Error ? error.message : "").toContain("nový náhľad");
  expect(await documentsHash(root)).toBe(before);
  await expect(readdir(join(root, ".lawoss/triage/runs", plan.runId))).resolves.not.toContain("plan.json");
});

test("súbor len na čítanie nie je zamknutý, zamietnutý zápis do zapisovateľného áno", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const readOnly = Object.keys(TRIAGE_FIXTURE).find(path => !path.includes("/") && path !== LOCKED_DOCX && !path.endsWith(".md"));
  if (!readOnly) throw new Error("Fixture needs a second top-level document.");
  await chmod(join(root, readOnly), 0o444);
  try {
    const inventory = await scanTriage(root, { hooks: wordHooks([readOnly, LOCKED_DOCX], "EPERM"), ...HOST });
    expect(inventory.documents.some(document => document.path === readOnly)).toBe(true);
    expect(inventory.skipped).toContainEqual({ path: LOCKED_DOCX, reason: "locked" });
  } finally { await chmod(join(root, readOnly), 0o644); }
});

// Skutočný zámok Windows ako Word: ostatní smú čítať (`Read`), zapisovať ani mazať nie.
test.skipIf(process.platform !== "win32")("Windows: dokument otvorený vo Worde sa preskočí v náhľade a nový zámok zastaví zápis", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  let release = await holdWindowsFileLock(join(root, LOCKED_DOCX), "Read");
  try {
    const inventory = await scanTriage(root, HOST);
    expect(inventory.skipped).toContainEqual({ path: LOCKED_DOCX, reason: "locked" });
    expect(inventory.documents.some(document => document.path === LOCKED_DOCX)).toBe(false);
  } finally { await release(); }
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  expect(plan.moves.some(move => move.from === LOCKED_DOCX)).toBe(true);
  const before = await documentsHash(root);
  release = await holdWindowsFileLock(join(root, LOCKED_DOCX), "Read");
  try {
    await expect(applyTriagePlan(plan, HOST)).rejects.toThrow(/nový náhľad/);
  } finally { await release(); }
  expect(await documentsHash(root)).toBe(before);
}, 60_000);

test("vrátenie s keepChanged ponechá upravený dokument a ostatné vráti", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  expect(plan.moves.length).toBeGreaterThan(1);
  await applyTriagePlan(plan, HOST);
  const changed = plan.moves[0]!;
  await writeFile(join(root, changed.to), "advokát to medzitým upravil");
  await expect(undoTriage(root, plan.runId, { keepChanged: false, ...HOST })).rejects.toThrow(/zmenených/);
  const result = await undoTriage(root, plan.runId, { keepChanged: true, ...HOST });
  expect(result).toMatchObject({ status: "undone", restored: plan.moves.length - 1 });
  expect(result.kept).toContain(changed.to);
  expect(await readFile(join(root, changed.to), "utf8")).toBe("advokát to medzitým upravil");
  for (const move of plan.moves.slice(1)) await expect(readFile(join(root, move.from))).resolves.toBeDefined();
});

test("bez keepChanged ostáva vrátenie všetko alebo nič a nič nezmení", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  await applyTriagePlan(plan, HOST);
  await writeFile(join(root, plan.moves[0]!.to), "zmena");
  const before = await documentsHash(root);
  await expect(undoTriage(root, plan.runId, { keepChanged: false, ...HOST })).rejects.toThrow();
  expect(await documentsHash(root)).toBe(before);
});

/** Prvý priečinok, ktorý beh vytvoril (karta veci). */
async function runCreatedDirectory(plan: { create: { kind: string; path: string }[] }): Promise<string> {
  const created = plan.create.find(operation => operation.kind === "directory");
  if (!created) throw new Error("Plan should create a directory.");
  return created.path;
}

test("Finder: .DS_Store vo vytvorenom priečinku nebráni vráteniu", async () => {
  const root = await convertedClient();
  const before = await documentsHash(root);
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  await applyTriagePlan(plan, HOST);
  await writeFile(join(root, await runCreatedDirectory(plan), ".DS_Store"), "x");
  const undone = await undoTriage(root, plan.runId, { keepChanged: false, ...HOST });
  expect(undone.status).toBe("undone");
  expect(await documentsHash(root)).toBe(before);
  await expect(readdir(join(root, await runCreatedDirectory(plan)))).rejects.toThrow();
});

test("Finder: s keepChanged sa priečinok s .DS_Store odstráni a nie je v kept", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  await applyTriagePlan(plan, HOST);
  const dir = await runCreatedDirectory(plan);
  await writeFile(join(root, dir, ".DS_Store"), "x");
  const result = await undoTriage(root, plan.runId, { keepChanged: true, ...HOST });
  expect(result.kept).not.toContain(dir);
  await expect(readdir(join(root, dir))).rejects.toThrow();
});

test("kept ukazuje na dokument, ktorý ostal na novom mieste, nie na nový súbor na starom", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  await applyTriagePlan(plan, HOST);
  const move = plan.moves[0]!;
  await writeFile(join(root, move.from), "nový súbor na starom mieste");
  const result = await undoTriage(root, plan.runId, { keepChanged: true, ...HOST });
  expect(result.kept).toContain(move.to);
  expect(result.kept).not.toContain(move.from);
  await expect(readFile(join(root, move.to))).resolves.toBeDefined();
  expect(await readFile(join(root, move.from), "utf8")).toBe("nový súbor na starom mieste");
});

test("súhlas nahradí značku patriacu inému priečinku (premenovaný klient)", async () => {
  const root = await convertedClient();
  await mkdir(join(root, ".lawoss"), { recursive: true });
  await writeFile(join(root, IN_PLACE_MARKER), JSON.stringify({ version: 1, root: "/stary/nazov", grantedAt: NOW.toISOString() }));
  await expect(verifyTriageTarget(root, undefined, HOST)).rejects.toThrow(/súhlas/);
  await grantInPlaceReorganize(root, NOW);
  expect(await verifyTriageTarget(root, undefined, HOST)).toEqual({ root, mode: "in_place", journalVerified: false });
  expect((await readdir(join(root, ".lawoss"))).filter(name => name !== "reorganize.json")).toEqual([]);
});

test("súhlas nahradí poškodenú značku", async () => {
  const root = await convertedClient();
  await mkdir(join(root, ".lawoss"), { recursive: true });
  await writeFile(join(root, IN_PLACE_MARKER), "{ nie json");
  await grantInPlaceReorganize(root, NOW);
  expect(await verifyTriageTarget(root, undefined, HOST)).toEqual({ root, mode: "in_place", journalVerified: false });
});

test("vrátenie na mieste bez voľby ponechá zmenený dokument", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  expect(plan.moves.length).toBeGreaterThan(1);
  await applyTriagePlan(plan, HOST);
  const changed = plan.moves[0]!;
  await writeFile(join(root, changed.to), "advokát to medzitým upravil");
  const result = await undoTriage(root, plan.runId, HOST);
  expect(result.status).toBe("undone");
  expect(result.kept).toContain(changed.to);
  expect(await readFile(join(root, changed.to), "utf8")).toBe("advokát to medzitým upravil");
});

test("chyby pre priečinok na mieste nehovoria o klone", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  await symlink(join(root, LOCKED_DOCX), join(root, "odkaz.docx"));
  await expect(scanTriage(root, HOST)).rejects.toThrow(/^(?!.*Klon)/);
  await rm(join(root, "odkaz.docx"));
  await writeFile(join(root, IN_PLACE_MARKER), "x".repeat(70 * 1024));
  await expect(verifyTriageTarget(root, undefined, HOST)).rejects.toThrow(/Značka priečinka/);
});
