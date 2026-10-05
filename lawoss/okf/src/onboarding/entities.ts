import { lstat, readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join, relative, resolve, sep } from "node:path";
import { inspectOnboardingParent, inspectOnboardingRoot } from "./classify.ts";
import { applyOnboardingPlan, type ApplyResult, type CreateOperation, type OnboardingPlan } from "./transaction.ts";
import { planEntity } from "../core.ts";
import { LOCALIZED_TEMPLATES } from "../templates.ts";
import { DEFAULT_FOLDER_ROLES, parseOfficeWorkingProfile, type WorkingProfile } from "../profile.ts";
import { findOfficeDir } from "../../../okf-pamat/src/store.ts";
import { contained } from "../../../okf-pamat/src/workspace-memory-fs.ts";
import { UNSAFE_FOLDER_NAME_MESSAGE } from "./messages.ts";
import { parseFrontmatter } from "../frontmatter.ts";

export type MatterKind = "contentious" | "non_contentious";
export type AppFiles = "inside" | "outside";
export type CreatePreview = { mode: "new"; appFiles: "inside"; target: string; clientRoot?: string; plan: OnboardingPlan };
export type MapPreview = { mode: "map"; appFiles: "outside"; root: string; sourceDigest: string; externalProfile: { version: 1; matterId: string; roots: { id: string; path: string }[]; sources: { id: string; root: string; path: string; role: "case_memory"; required: true; writable: false; anchors: string[] }[] } };
export type TrialClonePreview = { mode: "trial_clone"; appFiles: "inside"; source: string; sourceDigest: string; target: string; trial: true };
export type OfficeRequest = { parent: string; name?: string; jurisdiction: "sk" | "cz"; title: string; language: "sk" | "cs" | "en"; lawyerName: string };
export type ClientRequest = { parent: string; name: string; title: string; clientType: "fo" | "fo-podnikatel" | "po" | "iny"; jurisdiction: "sk" | "cz"; date: string; language?: "sk" | "cs" | "en" };
export type SubjectRequest = { clientRoot: string; name: string; title: string };
export type MatterRequest = { clientRoot: string; parent: string; title: string; date: string; kind: MatterKind; area: string; jurisdiction: "sk" | "cz"; subject?: string; language?: "sk" | "cs" | "en" };

/**
 * Folder name from a name the user typed. Inner dots stay ("Novák s. r. o."
 * becomes the folder "Novák s. r. o"); trailing dots and spaces are dropped,
 * because Windows strips them silently and the created path would no longer
 * match the planned one. The title keeps the full name. Still rejected: empty,
 * ".", "..", a leading dot (hidden), separators, ":" and NUL, over 120 characters,
 * control characters and Windows device names (CON, NUL, COM1, …, also with an
 * extension) — the transaction plan refuses them anyway, so the preview must too.
 */
export const safeSegment = (value: string) => {
  const trimmed = value.trim().replace(/[. ]+$/, "");
  if (!trimmed || trimmed.length > 120 || /[\\/:\0<>"|?*\u0001-\u001f\u007f-\u009f]|^\./.test(trimmed) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(trimmed)) throw new Error(UNSAFE_FOLDER_NAME_MESSAGE);
  return trimmed;
};
const yaml = (value: string) => JSON.stringify(value);
async function rootPlan(root: string, operations: CreateOperation[]): Promise<OnboardingPlan> {
  const canonical = await realpath(root);
  if (canonical !== resolve(root) || !(await lstat(canonical)).isDirectory()) throw new Error("Parent must be a canonical existing directory.");
  // Rodič sa len dopĺňa: plytký otlačok (Dokumenty na Windows majú skryté junctions, veľký priečinok limity).
  const inspection = await inspectOnboardingParent(canonical);
  if (!inspection.complete || !inspection.digest) throw new Error("Parent could not be inspected completely.");
  return { version: 1, root: canonical, treeDigest: inspection.digest, operations, scope: "parent" };
}
const directory = (path: string): CreateOperation => ({ path, kind: "directory" });
const file = (path: string, content: string): CreateOperation => ({ path, kind: "file", content });
function templateOperations(prefix: string, entries: ReturnType<typeof planEntity>["entries"]): CreateOperation[] {
  const operations: CreateOperation[] = [directory(prefix)]; const directories = new Set([prefix]);
  for (const entry of entries) {
    if (entry.action !== "create" || entry.content === undefined) continue;
    const parts = entry.path.split("/").slice(0, -1); let parent = prefix;
    for (const part of parts) { parent = `${parent}/${part}`; if (!directories.has(parent)) { operations.push(directory(parent)); directories.add(parent); } }
    operations.push(file(`${prefix}/${entry.path}`, entry.content));
  }
  return operations;
}
/** Pracovné priečinky novej veci aj ich roly výslovne; bez rolí by sa do založenej veci nedalo nič zaradiť. */
const officeConfig = (request: OfficeRequest) => {
  const roles = DEFAULT_FOLDER_ROLES[request.language];
  return `version: 1\ntitle: ${yaml(request.title)}\njurisdiction: ${request.jurisdiction}\nlanguage: ${request.language}\nlawyer_name: ${yaml(request.lawyerName)}\nstanding_authorization: ${yaml(request.lawyerName)}\nclient_path: "Klienti/*"\nareas: ["Corporate", "IP", "Pracovne"]\nmatter_folders: ${JSON.stringify(Object.values(roles))}\nfolder_roles: ${JSON.stringify(roles)}\n`;
};

export async function planOffice(request: OfficeRequest): Promise<CreatePreview> {
  const name = safeSegment(request.name ?? "Office");
  const target = join(request.parent, name);
  return { mode: "new", appFiles: "inside", target, plan: await rootPlan(request.parent, [directory(name), file(`${name}/okf.config`, officeConfig(request)), directory(`${name}/memory`), file(`${name}/memory/.keep`, ""), directory("Klienti"), file("Klienti/.keep", "")]) };
}
export async function planNewClient(request: ClientRequest): Promise<CreatePreview> {
  const name = safeSegment(request.name), target = join(request.parent, name), language = request.language ?? "sk";
  const generated = planEntity({ type: "klient", dir: target, title: request.title, clientType: request.clientType, language, jurisdiction: request.jurisdiction, date: request.date }, LOCALIZED_TEMPLATES, () => false);
  return { mode: "new", appFiles: "inside", target, clientRoot: target, plan: await rootPlan(request.parent, templateOperations(name, generated.entries)) };
}
export async function planNewSubject(request: SubjectRequest): Promise<CreatePreview> {
  const name = safeSegment(request.name), target = join(request.clientRoot, name);
  const client = await inspectOnboardingRoot(request.clientRoot);
  if (!client.complete || client.level !== "client") throw new Error("Subject parent must be an inspected client root.");
  const card = `---\ntype: subject\ntitle: ${yaml(request.title)}\n---\n\n# ${request.title}\n`;
  return { mode: "new", appFiles: "inside", target, clientRoot: request.clientRoot, plan: await rootPlan(request.clientRoot, [directory(name), file(`${name}/subject.md`, card), directory(`${name}/memory`), file(`${name}/memory/.keep`, "")]) };
}
/** Veci klienta žijú v `Spisy/` ako v šablóne klienta, jeho AGENTS.md, CLI `novy-spis` aj v čítaní pamäte. */
const MATTERS_DIR = "Spisy";
const CLIENT_CARDS = ["client.md", "klient.md"];

/** Karta klienta a jej názov, aby nová vec vedela, komu patrí (`klient:` a odkaz v matter.md). */
async function clientCard(clientRoot: string): Promise<{ file: string; title?: string } | undefined> {
  for (const name of CLIENT_CARDS) {
    const file = join(clientRoot, name);
    const content = await readFile(file, "utf8").catch(() => undefined);
    if (content === undefined) continue;
    const title = parseFrontmatter(content)?.title?.trim();
    return title ? { file, title } : { file };
  }
  return undefined;
}

/** Údaje karty novej veci nad rámec formulára; triedenie ich vie doplniť zo spisovej značky. */
export type MatterCardExtras = { caseNumber?: string; counterparty?: string; court?: string };
export type MatterOperationsInput = {
  title: string; date: string; kind: MatterKind; area: string; jurisdiction: "sk" | "cz";
  subject?: string; language?: "sk" | "cs" | "en"; workingProfile?: WorkingProfile;
  clientTitle?: string; clientCardPath?: string; extras?: MatterCardExtras;
};
/**
 * Deterministické operácie jednej novej veci relatívne ku klientovi (`Spisy/<RRRR-MM> <názov>/…`)
 * bez priečinka `Spisy`. Rovnaký zdroj pre formulár novej veci aj pre roztriedenie spisu.
 */
export function buildMatterOperations(input: MatterOperationsInput): { name: string; folder: string; operations: CreateOperation[] } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !["contentious", "non_contentious"].includes(input.kind)) throw new Error("Valid date and matter kind are required.");
  // Oblasť je údaj veci (`area:` v matter.md), nie priečinok.
  const area = safeSegment(input.area), name = `${input.date.slice(0, 7)} ${safeSegment(input.title)}`, folder = `${MATTERS_DIR}/${name}`;
  const generated = planEntity({ type: "spis", dir: folder, title: input.title, language: input.language, jurisdiction: input.jurisdiction, date: input.date, workingProfile: input.workingProfile, matterKind: input.kind === "contentious" ? "dispute" : "other", ...(input.clientTitle ? { klient: input.clientTitle } : {}), ...(input.clientCardPath ? { clientCardPath: input.clientCardPath } : {}), ...(input.extras?.caseNumber ? { spzn: input.extras.caseNumber } : {}), ...(input.extras?.counterparty ? { protistrana: input.extras.counterparty } : {}), ...(input.extras?.court ? { sud: input.extras.court } : {}) }, LOCALIZED_TEMPLATES, () => false);
  const template = templateOperations(folder, generated.entries).filter(operation => operation.path !== folder);
  const operations = [directory(folder), ...template.map(operation => operation.path === `${folder}/matter.md` && operation.kind === "file" ? file(operation.path, (operation.content ?? "").replace("type: spis", `type: matter\nkind: ${input.kind}\narea: ${yaml(area)}\nsubject: ${yaml(input.subject ?? "")}`)) : operation)];
  return { name, folder, operations };
}

export async function planNewMatter(request: MatterRequest): Promise<CreatePreview> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.date) || !["contentious", "non_contentious"].includes(request.kind)) throw new Error("Valid date and matter kind are required.");
  safeSegment(request.area);
  const name = `${request.date.slice(0, 7)} ${safeSegment(request.title)}`, target = join(request.parent, MATTERS_DIR, name);
  const clientRoot = await realpath(request.clientRoot), parentRoot = await realpath(request.parent);
  // Windows: realpath vracia `\`, porovnanie s `${clientRoot}/` by odmietlo každý subjekt klienta.
  if (!contained(clientRoot, parentRoot)) throw new Error("Matter parent must be within the inspected client root.");
  const client = await inspectOnboardingRoot(clientRoot);
  if (!client.complete || client.level !== "client") throw new Error("Matter client root must be an inspected client.");
  const inspected = await inspectOnboardingParent(request.parent);
  if (!inspected.complete) throw new Error("Matter parent could not be inspected completely.");
  const existingMatters = inspected.entries.find(entry => entry.path === MATTERS_DIR);
  if (existingMatters && existingMatters.kind !== "directory") throw new Error("Matter folder is blocked by a non-directory.");
  const office = findOfficeDir(request.parent);
  const workingProfile = office ? parseOfficeWorkingProfile(await readFile(join(office, "okf.config"), "utf8"), request.language ?? "sk") : undefined;
  const card = await clientCard(clientRoot);
  const clientCardPath = card ? relative(join(parentRoot, MATTERS_DIR, name), card.file).split(sep).join("/") : undefined;
  const built = buildMatterOperations({ ...request, workingProfile, clientTitle: card?.title, clientCardPath });
  const operations = [...(existingMatters ? [] : [directory(MATTERS_DIR)]), ...built.operations];
  return { mode: "new", appFiles: "inside", target, clientRoot: request.clientRoot, plan: await rootPlan(request.parent, operations) };
}
export async function executeCreate(preview: CreatePreview, journalDirectory: string): Promise<ApplyResult> { return applyOnboardingPlan(preview.plan, journalDirectory); }
export async function planExistingClient(root: string, mode: "map" | "trial_clone", cloneParent?: string, map?: { memoryPath: string; identityAnchor: string }): Promise<MapPreview | TrialClonePreview> {
  const inspection = await inspectOnboardingRoot(root);
  if (!inspection.complete || !inspection.digest) throw new Error("Source client could not be inspected completely.");
  if (["office", "matter", "conflict"].includes(inspection.level)) throw new Error("Source must be a client or an explicitly confirmed unknown directory.");
  if (mode === "map") {
    if (!map || !inspection.memorySources.includes(map.memoryPath) || !map.identityAnchor.trim()) throw new Error("Map mode requires a selected inspected memory path and identity anchor.");
    const memory = await readFile(join(inspection.root, map.memoryPath), "utf8");
    if (Buffer.byteLength(memory) > 1024 * 1024 || !memory.includes(map.identityAnchor)) throw new Error("Map identity anchor must occur in the selected bounded memory source.");
    const rechecked = await inspectOnboardingRoot(inspection.root);
    if (!rechecked.complete || rechecked.digest !== inspection.digest) throw new Error("Source client changed while planning map.");
    const matterId = `map_${createHash("sha256").update(`${inspection.root}:${map.identityAnchor}`).digest("hex").slice(0, 24)}`;
    return { mode, appFiles: "outside", root: inspection.root, sourceDigest: inspection.digest, externalProfile: { version: 1, matterId, roots: [{ id: "client", path: inspection.root }], sources: [{ id: "existing_memory", root: "client", path: map.memoryPath, role: "case_memory", required: true, writable: false, anchors: [map.identityAnchor] }] } };
  }
  if (!cloneParent) throw new Error("Trial clone parent is required.");
  const target = join(cloneParent, `${safeSegment(basename(inspection.root) || "client")} (trial ${new Date().toISOString().slice(0, 10)})`);
  return { mode, appFiles: "inside", source: inspection.root, sourceDigest: inspection.digest, target, trial: true };
}
