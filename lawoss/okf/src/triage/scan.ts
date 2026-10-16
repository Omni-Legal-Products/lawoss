/**
 * Overenie skúšobného klona a inventár jeho dokumentov. Iba čítanie.
 *
 * Roztriedenie smie presúvať dokumenty výhradne v skúšobnom klone. Klon spoznáme podľa značky
 * `.lawoss-trial.json`, ktorú zapisuje `applyTrialClone` (verzia, zdroj, odtlačok kópie). Ak volajúci
 * pozná priečinok záznamov onboardingu (server appky), overí aj dokončený záznam kópie pre presne
 * tento priečinok; samotná značka skopírovaná do originálu potom nestačí.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { realpath } from "../canonical-path.ts";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { findOfficeDir } from "../../../okf-pamat/src/store.ts";
import { decodeText } from "../../../okf-pamat/src/text-decode.ts";
import { parseFrontmatter } from "../frontmatter.ts";
import { resolveDocumentLanguage } from "../language.ts";
import { parseOfficeWorkingProfile, parseWorkingProfile, PROFILE_FILE, workingProfile } from "../profile.ts";
import { inspectCardLevel, inspectOnboardingRoot, type InspectionHooks, type InspectionLimits, type OnboardingInspection, type TreeEntry } from "../onboarding/classify.ts";
import { looksLikeMatterName } from "../onboarding/suggest-patterns.ts";
import { findCaseNumber } from "./rules.ts";
import { INVENTORY_SCHEMA, type ExistingMatter, type SkipReason, type TriageDocument, type TriageInventory } from "./types.ts";

export const TRIAL_MARKER = ".lawoss-trial.json";
export const TRIAGE_DIR = ".lawoss/triage";
/** Najviac dokumentov v jednom behu; väčší klient sa roztriedi po častiach (najprv jeden priečinok). */
export const MAX_TRIAGE_DOCUMENTS = 2000;

export class TrialCloneError extends Error { readonly code = "not_trial_clone"; }
const NOT_TRIAL_CLONE = "Toto nie je skúšobný klon. Dokumenty sa presúvajú len v skúšobnom klone, nikdy v origináli.";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const overlaps = (a: string, b: string) => { const rel = relative(a, b); return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`)); };
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";

async function readBounded(path: string, max: number): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > max) throw new TrialCloneError("Značka priečinka nie je obyčajný malý súbor.");
    const buffer = Buffer.alloc(max + 1);
    let size = 0;
    while (size < buffer.length) { const read = await handle.read(buffer, size, buffer.length - size, null); if (!read.bytesRead) break; size += read.bytesRead; }
    if (size > max) throw new TrialCloneError("Značka priečinka je príliš veľká.");
    return buffer.subarray(0, size).toString("utf8");
  } finally { await handle.close(); }
}

export type TrialClone = { root: string; source: string; fingerprint: string; journalVerified: boolean };

/**
 * Odmietne všetko, čo nie je overený skúšobný klon. `trialJournalDirectory` je priečinok
 * záznamov onboardingu (`trial-<odtlačok>.json`); server appky ho odovzdáva vždy.
 */
export async function verifyTrialClone(rootInput: string, trialJournalDirectory?: string): Promise<TrialClone> {
  if (!isAbsolute(rootInput)) throw new TrialCloneError("Cesta ku klonu musí byť absolútna.");
  const root = resolve(rootInput);
  try { if (await realpath(root) !== root || !(await lstat(root)).isDirectory()) throw new TrialCloneError("Klon musí byť existujúci priečinok bez symbolických odkazov."); }
  catch (error) { if (error instanceof TrialCloneError) throw error; throw new TrialCloneError("Klon musí byť existujúci priečinok."); }
  let marker: unknown;
  try { marker = JSON.parse(await readBounded(join(root, TRIAL_MARKER), 64 * 1024)); }
  catch (error) {
    if (error instanceof TrialCloneError) throw error;
    throw new TrialCloneError(missing(error) ? NOT_TRIAL_CLONE : "Značka priečinka je poškodená.");
  }
  if (!record(marker) || marker.version !== 1 || marker.trial !== true || typeof marker.source !== "string" || !isAbsolute(marker.source)
    || typeof marker.sourceDigest !== "string" || !/^[a-f0-9]{64}$/.test(marker.sourceDigest) || typeof marker.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(marker.fingerprint)) {
    throw new TrialCloneError("Značka priečinka má neplatný tvar.");
  }
  const source = resolve(marker.source);
  if (overlaps(source, root) || overlaps(root, source)) throw new TrialCloneError("Klon sa prekrýva so svojím originálom.");
  let journalVerified = false;
  if (trialJournalDirectory !== undefined) {
    let journal: unknown;
    try { journal = JSON.parse(await readFile(join(trialJournalDirectory, `trial-${marker.fingerprint}.json`), "utf8")); }
    catch { throw new TrialCloneError("K tomuto priečinku chýba záznam o vytvorení skúšobného klona v tejto aplikácii."); }
    if (!record(journal) || journal.version !== 1 || journal.fingerprint !== marker.fingerprint || journal.phase !== "complete" || !record(journal.preview)
      || journal.preview.target !== root || journal.preview.source !== source || sha(JSON.stringify(journal.preview)) !== marker.fingerprint) {
      throw new TrialCloneError("Záznam o skúšobnom klone nezodpovedá tomuto priečinku.");
    }
    journalVerified = true;
  }
  return { root, source, fingerprint: marker.fingerprint, journalVerified };
}

/** Výslovný súhlas advokáta s usporiadaním priečinka klienta na mieste (spec: „Áno, usporiadaj“). */
export const IN_PLACE_MARKER = ".lawoss/reorganize.json";
export type TriageTarget = { root: string; mode: "trial" | "in_place"; journalVerified: boolean };
const NO_CONSENT = "Dokumenty sa presúvajú len po výslovnom súhlase s usporiadaním priečinka alebo v skúšobnom klone.";

/** Zapíše súhlas do `.lawoss/` klienta. Skrytý priečinok je mimo otlačku roztriedenia, náhľad sa ním nezmení. */
export async function grantInPlaceReorganize(rootInput: string, now: Date = new Date()): Promise<void> {
  if (!isAbsolute(rootInput)) throw new Error("Cesta ku klientovi musí byť absolútna.");
  const root = resolve(rootInput);
  if (await realpath(root) !== root || !(await lstat(root)).isDirectory()) throw new Error("Klient musí byť existujúci priečinok bez symbolických odkazov.");
  // Identita z karty v koreni (plytko): symbolický odkaz či veľký dokument v podpriečinku súhlas neblokuje,
  // náhľad a zápis potom aj tak robia plnú inšpekciu.
  if ((await inspectCardLevel(root)).level !== "client") throw new Error("Usporiadať sa dá len priečinok klienta s kartou klienta. Najprv pridajte OKF súbory.");
  const dir = join(root, ".lawoss");
  await mkdir(dir, { recursive: true });
  // `.lawoss` ako symbolický odkaz (či junction) by značku zapísal mimo priečinka klienta (review VŘ k #137, bod 6).
  const state = await lstat(dir);
  if (state.isSymbolicLink() || !state.isDirectory() || await realpath(dir) !== dir) throw new Error("Priečinok .lawoss klienta nesmie byť symbolický odkaz.");
  const content = JSON.stringify({ version: 1, root, grantedAt: now.toISOString() });
  try { await writeFile(join(root, IN_PLACE_MARKER), content, { flag: "wx" }); }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    // Značku vlastní appka: platnú pre tento priečinok ponecháme, cudziu (premenovaný alebo skopírovaný klient)
    // či poškodenú nahradíme novým výslovným súhlasom. Zápis je atómový: dočasný súbor a premenovanie.
    let current = false;
    try { const existing: unknown = JSON.parse(await readBounded(join(root, IN_PLACE_MARKER), 64 * 1024)); current = record(existing) && existing.root === root; } catch { current = false; }
    if (current) return;
    const temporary = join(dir, `reorganize.json.${process.pid}.${Date.now()}.tmp`);
    try { await writeFile(temporary, content, { flag: "wx" }); await rename(temporary, join(root, IN_PLACE_MARKER)); }
    catch (failure) { await rm(temporary, { force: true }); throw failure; }
  }
}

/**
 * Usporiadanie na mieste je predvolene vypnuté (`allowInPlace: false`): presúva sa len v skúšobnom klone.
 * Značka `.lawoss/reorganize.json` v priečinku klienta je len súbor, ktorý môže zapísať ktokoľvek (aj agent),
 * preto sama súhlas nedokazuje. `allowInPlace: true` smie poslať len hostiteľ, ktorý súhlas advokáta overil
 * vo vlastnom zázname mimo priečinka klienta (C1, lawoss#137); značka sa potom kontroluje ďalej. Server ani CLI
 * ho v lawoss#135 neposielajú, originál teda odmietnu náhľad, zápis aj vrátenie.
 */
export type TriageTargetOptions = { allowInPlace?: boolean };

/** Skúšobný klon (podľa značky) alebo, ak to volajúci výslovne dovolí, klient so súhlasom na mieste; inak odmietne. */
export async function verifyTriageTarget(rootInput: string, trialJournalDirectory?: string, options: TriageTargetOptions = {}): Promise<TriageTarget> {
  if (!isAbsolute(rootInput)) throw new TrialCloneError("Cesta musí byť absolútna.");
  const root = resolve(rootInput);
  const trial = await lstat(join(root, TRIAL_MARKER)).then(() => true, error => { if (missing(error)) return false; throw error; });
  if (trial) { const clone = await verifyTrialClone(root, trialJournalDirectory); return { root: clone.root, mode: "trial", journalVerified: clone.journalVerified }; }
  if (options.allowInPlace !== true) throw new TrialCloneError(NOT_TRIAL_CLONE);
  if (await realpath(root).catch(() => "") !== root) throw new TrialCloneError("Priečinok musí existovať a nesmie byť symbolický odkaz.");
  let consent: unknown;
  try { consent = JSON.parse(await readBounded(join(root, IN_PLACE_MARKER), 64 * 1024)); }
  catch (error) { if (error instanceof TrialCloneError) throw error; throw new TrialCloneError(NO_CONSENT); }
  if (!record(consent) || consent.version !== 1 || consent.root !== root || typeof consent.grantedAt !== "string") throw new TrialCloneError(NO_CONSENT);
  return { root, mode: "in_place", journalVerified: false };
}

const CARD_NAMES = new Set(["client.md", "klient.md", "matter.md", "spis.md", "project.md", "projekt.md", "subject.md"]);
const MATTER_CARDS = ["matter.md", "spis.md", "project.md", "projekt.md"];
/** Súbory, ktoré si OKF alebo agent číta podľa mena; presunuté by zmenili význam priečinka. */
const SYSTEM_NAMES = /^(?:agents\.md|claude\.md|brain\.md|memory\.md|_memory\.md|_status\.md|index\.md|log\.md|vstupy\.md|pracovny-profil\.md|komunikacne-kanaly\.md|okf\.config|\.keep)$/i;
const hidden = (path: string) => path.split("/").some(part => part.startsWith("."));
/** Odtlačok stromu bez skrytých položiek: zápisy appky (`.lawoss`, `.opencode`) a Findera neprerušia náhľad. */
export const triageTreeDigest = (entries: readonly TreeEntry[]) => sha(JSON.stringify(entries.filter(entry => !hidden(entry.path))));

async function readSmall(root: string, path: string): Promise<string | undefined> {
  try { return await readBounded(join(root, path), 1024 * 1024); } catch (error) { if (missing(error)) return undefined; throw error; }
}

/**
 * Háky roztriedenia. `writeProbe` je test-only náhrada sondy zápisu (zámok Wordu sa mimo Windows
 * nedá vyrobiť); server ani CLI ju neposielajú.
 */
export type TriageHooks = InspectionHooks & { writeProbe?: (path: string) => Promise<void> };
const errorCode = (error: unknown): string => error instanceof Error && "code" in error ? String(error.code) : "";

/** Windows: otvorenie na zápis bez O_TRUNC/O_CREAT obsah ani čas zmeny nemení. Inde súbor zámok nedrží. */
async function defaultWriteProbe(path: string): Promise<void> {
  if (process.platform !== "win32") return;
  const handle = await open(path, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  await handle.close();
}

/**
 * Drží súbor iný program tak, že ho presun nezmaže? Word dovolí otvorený dokument čítať (inšpekcia
 * prejde), zapisovať ani mazať nie; `unlink` po pevnom odkaze by skončil EBUSY uprostred behu.
 * Rovnako ako `assertSourcesWritable` v naming-fs.ts: EBUSY je zámok, EPERM/EACCES len pri súbore,
 * ktorý nie je iba na čítanie (ten sa presúva aj bez práva zápisu do samotného súboru).
 */
export async function lockedForWrite(path: string, hooks: TriageHooks = {}): Promise<boolean> {
  try { await (hooks.writeProbe ?? defaultWriteProbe)(path); return false; }
  catch (error) {
    const code = errorCode(error);
    if (code === "EBUSY") return true;
    if (code !== "EPERM" && code !== "EACCES") throw error;
    const state = await lstat(path);
    return !(state.isFile() && (state.mode & 0o222) === 0);
  }
}

/** Neúplná inšpekcia len kvôli zamknutým súborom (Word, Outlook): tie sa preskočia, zvyšok sa dá usporiadať. */
export const onlyLockedIssues = (inspection: OnboardingInspection): boolean =>
  inspection.issues.length > 0 && inspection.issues.every(issue => issue.code === "locked_file");

/**
 * Inventár dokumentov, ktoré má zmysel roztriediť: všetko mimo systémových súborov, pamäte,
 * existujúcich vecí a už zaradených pracovných priečinkov. Súbory v priečinku na zatriedenie sa triedia.
 */
export async function scanTriage(rootInput: string, options: TriageTargetOptions & { trialJournalDirectory?: string; limits?: InspectionLimits; jurisdiction?: "sk" | "cz"; hooks?: TriageHooks } = {}): Promise<TriageInventory> {
  const clone = await verifyTriageTarget(rootInput, options.trialJournalDirectory, options);
  const inspection = await inspectOnboardingRoot(clone.root, options.limits, options.hooks);
  if (!inspection.complete && !onlyLockedIssues(inspection)) {
    const issue = inspection.issues[0];
    throw new Error(issue?.code === "symlink_not_followed" ? `Priečinok obsahuje symbolický odkaz (${issue.path}); roztriedenie ho nesleduje. Odstráňte ho z priečinka.` : `Priečinok sa nepodarilo prečítať celý (${issue?.code ?? "neznámy dôvod"}${issue?.path ? `: ${issue.path}` : ""}).`);
  }
  if (inspection.level !== "client") throw new Error("Usporiadať sa dá len priečinok klienta s kartou klienta.");
  const files = new Map(inspection.entries.filter(entry => entry.kind === "file").map(entry => [entry.path, entry]));
  const clientCard = ["client.md", "klient.md"].find(name => files.has(name))!;
  const card = parseFrontmatter((await readSmall(clone.root, clientCard)) ?? "") ?? {};
  const language = resolveDocumentLanguage(["sk", "cs", "en"].includes(card.language ?? "") ? card.language : undefined, card.jurisdiction);
  const office = findOfficeDir(clone.root);
  // okf.config z Windows (BOM, UTF-16) dekódovaný ako v CLI (lawoss/okf/src/fs.ts).
  const config = office ? await readFile(join(office, "okf.config")).then(decodeText, () => undefined) : undefined;
  // Karta klienta jurisdikciu nenesie; poradie: volajúci (profil onboardingu), karta, kancelária, jazyk.
  const officeJurisdiction = /^jurisdiction:\s*(sk|cz)\s*$/m.exec(config ?? "")?.[1];
  const jurisdiction = options.jurisdiction ?? (card.jurisdiction === "cz" || card.jurisdiction === "sk" ? card.jurisdiction : officeJurisdiction === "cz" || officeJurisdiction === "sk" ? officeJurisdiction : language === "cs" ? "cz" : "sk");
  const profileText = files.has(PROFILE_FILE) ? await readSmall(clone.root, PROFILE_FILE) : undefined;
  const profile = profileText ? parseWorkingProfile(profileText) : workingProfile(undefined, undefined, undefined, language);
  const officeProfile = config !== undefined ? parseOfficeWorkingProfile(config, language) : undefined;
  // Kancelária s priečinkami bez rolí (starší vzor okf.config) by založila vec, do ktorej sa nedá nič
  // zaradiť; nová vec vtedy dostane pracovný profil klienta, ktorý roly výslovne má (test 5. 10. 2026).
  const newMatterProfile = officeProfile && Object.keys(officeProfile.roles).length ? officeProfile
    : officeProfile && Object.keys(profile.roles).length ? { folders: profile.folders, roles: profile.roles, naming: profile.naming } : officeProfile;

  const directories = new Set(inspection.entries.filter(entry => entry.kind === "directory").map(entry => entry.path));
  const entityDirs = [...files.keys()].filter(path => path.includes("/") && CARD_NAMES.has(path.split("/").pop()!.toLowerCase())).map(path => path.split("/").slice(0, -1).join("/"));
  const matters: ExistingMatter[] = [];
  for (const dir of entityDirs.filter(dir => /^Spisy\/[^/]+$/.test(dir)).sort()) {
    const cardName = MATTER_CARDS.find(name => files.has(`${dir}/${name}`));
    if (!cardName) continue;
    const fields = parseFrontmatter((await readSmall(clone.root, `${dir}/${cardName}`)) ?? "") ?? {};
    let roles: Record<string, string> = {};
    try { const text = await readSmall(clone.root, `${dir}/${PROFILE_FILE}`); if (text) roles = parseWorkingProfile(text).roles; } catch { roles = {}; }
    // Vec bez rolí: výslovné roly klienta platia pre rovnako pomenované priečinky, ktoré vec naozaj má.
    if (!Object.keys(roles).length) roles = Object.fromEntries(Object.entries(profile.roles).filter(([, folder]) => directories.has(`${dir}/${folder}`)));
    const caseKey = fields.spisova_znacka ? findCaseNumber(fields.spisova_znacka)?.key : undefined;
    matters.push({ id: `existing-${sha(dir).slice(0, 12)}`, path: dir, ...(fields.title ? { title: fields.title } : {}), ...(caseKey ? { caseKey } : {}), roles });
  }
  const under = (path: string, folder: string) => path.startsWith(`${folder}/`);
  // Priamy podpriečinok klienta pomenovaný ako vec (`Kupa haly Senec`, `Spor BETA 18Cb-47-2026`) je vec aj bez
  // karty. Ostáva na mieste: jeho dokumenty sa zaraďujú len v rámci neho a plán mu doplní kartu (test 16. 10. 2026, N2, N5).
  // Pracovné priečinky klienta, `Spisy`, pamäť a kancelária vecami nie sú; priečinok s kartou vnútri rieši karta.
  const clientFolders = new Set([...profile.folders, ...Object.values(profile.roles)].map(folder => folder.split("/")[0]!.toLocaleLowerCase()));
  const matterProfile = workingProfile(newMatterProfile?.folders, newMatterProfile?.roles, newMatterProfile?.naming, language);
  for (const dir of [...directories].filter(dir => !dir.includes("/") && !hidden(dir)).sort()) {
    if (["spisy", "memory", "office", "_kancelaria"].includes(dir.toLocaleLowerCase()) || clientFolders.has(dir.toLocaleLowerCase())) continue;
    if (!looksLikeMatterName(dir) || entityDirs.some(entity => entity === dir || under(entity, dir))) continue;
    if (![...files.keys()].some(path => under(path, dir) && !hidden(path))) continue;
    const caseNumber = findCaseNumber(dir);
    let roles = matterProfile.roles;
    try { const text = await readSmall(clone.root, `${dir}/${PROFILE_FILE}`); if (text) roles = parseWorkingProfile(text).roles; } catch { roles = matterProfile.roles; }
    matters.push({ id: `existing-${sha(dir).slice(0, 12)}`, path: dir, title: dir, ...(caseNumber ? { caseKey: caseNumber.key } : {}), roles, implicit: caseNumber ? { caseNumber: caseNumber.display } : {} });
  }
  const inbox = profile.roles.inbox;
  const sortedFolders = Object.entries(profile.roles).filter(([role]) => role !== "inbox").map(([, folder]) => folder);
  /** Vec bez karty, v ktorej dokument leží, a dôvod, ak sa v nej netriedi (vnorená vec, už zaradený). */
  const implicitHome = (path: string): { matter: ExistingMatter; reason?: SkipReason } | undefined => {
    const matter = matters.find(item => item.implicit && under(path, item.path));
    if (!matter) return undefined;
    const rest = path.slice(matter.path.length + 1);
    if (rest.split("/").slice(0, -1).some(looksLikeMatterName)) return { matter, reason: "in_matter" };
    const sorted = Object.entries(matter.roles).filter(([role]) => role !== "inbox").map(([, folder]) => folder);
    return sorted.some(folder => under(rest, folder)) && !(matter.roles.inbox && under(rest, matter.roles.inbox)) ? { matter, reason: "already_sorted" } : { matter };
  };
  const documents: TriageDocument[] = [];
  const skipped: { path: string; reason: SkipReason }[] = [];
  for (const entry of files.values()) {
    const name = entry.path.split("/").pop()!;
    const home = implicitHome(entry.path);
    const reason: SkipReason | undefined = hidden(entry.path) ? "hidden"
      : entry.path.split("/")[0] === "memory" ? "memory"
      : !entry.path.includes("/") && (CARD_NAMES.has(name.toLowerCase()) || SYSTEM_NAMES.test(name)) ? "system"
      : CARD_NAMES.has(name.toLowerCase()) || SYSTEM_NAMES.test(name) ? "system_name"
      : matters.some(matter => !matter.implicit && under(entry.path, matter.path)) ? "in_matter"
      : entityDirs.some(dir => under(entry.path, dir)) ? "inside_entity"
      : home ? home.reason
      // Hlbšie vnorený priečinok pomenovaný ako vec (`Stare/2025-01 Spor`) je vec aj bez karty. Jeho dokumenty
      // ostanú spolu na mieste, roztriedenie vec nerozpustí; kartu dostane len priamy podpriečinok klienta (vyššie).
      : entry.path.split("/").slice(0, -1).some(looksLikeMatterName) ? "in_matter"
      : sortedFolders.some(folder => under(entry.path, folder)) && !(inbox && under(entry.path, inbox)) ? "already_sorted"
      : undefined;
    if (reason) { if (reason !== "hidden") skipped.push({ path: entry.path, reason }); continue; }
    // Otvorený vo Worde: na čítanie áno, presunúť sa nedá. Preskočí sa a nahlási ako zamknutý.
    if (await lockedForWrite(join(clone.root, entry.path), options.hooks)) { skipped.push({ path: entry.path, reason: "locked" }); continue; }
    const dot = name.lastIndexOf(".");
    documents.push({ id: `d${sha(entry.path).slice(0, 16)}`, path: entry.path, name, ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : "", size: entry.size, sha256: entry.digest!, ...(home ? { matter: home.matter.id } : {}) });
  }
  for (const issue of inspection.issues) if (issue.code === "locked_file") skipped.push({ path: issue.path, reason: "locked" });
  if (documents.length > MAX_TRIAGE_DOCUMENTS) throw new Error(`Priečinok má ${documents.length} dokumentov na roztriedenie; naraz sa dá najviac ${MAX_TRIAGE_DOCUMENTS}.`);
  documents.sort((a, b) => a.path.localeCompare(b.path));
  return {
    schema: INVENTORY_SCHEMA, root: clone.root, treeDigest: triageTreeDigest(inspection.entries), language, jurisdiction,
    client: { ...(card.title ? { title: card.title } : {}), card: clientCard },
    profile: { folders: profile.folders, roles: profile.roles },
    ...(newMatterProfile ? { newMatterProfile } : {}),
    matters, documents, skipped,
    occupied: [...directories, ...inspection.entries.filter(entry => entry.kind !== "directory").map(entry => entry.path)].sort(),
  };
}

/** Názov klona býva „<klient> (trial RRRR-MM-DD)“; slúži len na zobrazenie, rozhoduje značka. */
export const looksLikeTrialName = (root: string) => / \(trial \d{4}-\d{2}-\d{2}\)$/.test(basename(root));
