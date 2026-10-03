import { lstat, readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { inspectOnboardingRoot } from "./classify.ts";
import { applyOnboardingPlan, type ApplyResult, type CreateOperation, type OnboardingPlan } from "./transaction.ts";
import { planEntity } from "../core.ts";
import { LOCALIZED_TEMPLATES } from "../templates.ts";
import { parseOfficeWorkingProfile } from "../profile.ts";
import { findOfficeDir } from "../../../okf-pamat/src/store.ts";

export type MatterKind = "contentious" | "non_contentious";
export type AppFiles = "inside" | "outside";
export type CreatePreview = { mode: "new"; appFiles: "inside"; target: string; clientRoot?: string; plan: OnboardingPlan };
export type MapPreview = { mode: "map"; appFiles: "outside"; root: string; sourceDigest: string; externalProfile: { version: 1; matterId: string; roots: { id: string; path: string }[]; sources: { id: string; root: string; path: string; role: "case_memory"; required: true; writable: false; anchors: string[] }[] } };
export type TrialClonePreview = { mode: "trial_clone"; appFiles: "inside"; source: string; sourceDigest: string; target: string; trial: true };
export type OfficeRequest = { parent: string; name?: string; jurisdiction: "sk" | "cz"; title: string; language: "sk" | "cs" | "en"; lawyerName: string };
export type ClientRequest = { parent: string; name: string; title: string; clientType: "fo" | "fo-podnikatel" | "po" | "iny"; jurisdiction: "sk" | "cz"; date: string; language?: "sk" | "cs" | "en" };
export type SubjectRequest = { clientRoot: string; name: string; title: string };
export type MatterRequest = { clientRoot: string; parent: string; title: string; date: string; kind: MatterKind; area: string; jurisdiction: "sk" | "cz"; subject?: string; language?: "sk" | "cs" | "en" };

const safeSegment = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120 || /[\\/:\0]|^\.|[. ]$/.test(trimmed)) throw new Error("A safe non-empty folder name is required.");
  return trimmed;
};
const yaml = (value: string) => JSON.stringify(value);
async function rootPlan(root: string, operations: CreateOperation[]): Promise<OnboardingPlan> {
  const canonical = await realpath(root);
  if (canonical !== resolve(root) || !(await lstat(canonical)).isDirectory()) throw new Error("Parent must be a canonical existing directory.");
  const inspection = await inspectOnboardingRoot(canonical);
  if (!inspection.complete || !inspection.digest) throw new Error("Parent could not be inspected completely.");
  return { version: 1, root: canonical, treeDigest: inspection.digest, operations };
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
const officeConfig = (request: OfficeRequest) => `version: 1\ntitle: ${yaml(request.title)}\njurisdiction: ${request.jurisdiction}\nlanguage: ${request.language}\nlawyer_name: ${yaml(request.lawyerName)}\nstanding_authorization: ${yaml(request.lawyerName)}\nclient_path: "Klienti/*"\nareas: ["Corporate", "IP", "Pracovne"]\nmatter_folders: ["00_Na_zatriedenie", "01_Podklady", "02_Resers", "03_Drafty", "04_Vystupy", "05_Komunikacia"]\n`;

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
export async function planNewMatter(request: MatterRequest): Promise<CreatePreview> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.date) || !["contentious", "non_contentious"].includes(request.kind)) throw new Error("Valid date and matter kind are required.");
  const area = safeSegment(request.area), name = `${request.date.slice(0, 7)} ${safeSegment(request.title)}`, target = join(request.parent, area, name);
  const clientRoot = await realpath(request.clientRoot), parentRoot = await realpath(request.parent);
  if (parentRoot !== clientRoot && !parentRoot.startsWith(`${clientRoot}/`)) throw new Error("Matter parent must be within the inspected client root.");
  const client = await inspectOnboardingRoot(clientRoot);
  if (!client.complete || client.level !== "client") throw new Error("Matter client root must be an inspected client.");
  const inspected = await inspectOnboardingRoot(request.parent);
  if (!inspected.complete) throw new Error("Matter parent could not be inspected completely.");
  const existingArea = inspected.entries.find(entry => entry.path === area);
  if (existingArea && existingArea.kind !== "directory") throw new Error("Matter area is blocked by a non-directory.");
  const office = findOfficeDir(request.parent);
  const workingProfile = office ? parseOfficeWorkingProfile(await readFile(join(office, "okf.config"), "utf8"), request.language ?? "sk") : undefined;
  const generated = planEntity({ type: "spis", dir: target, title: request.title, language: request.language, jurisdiction: request.jurisdiction, date: request.date, workingProfile }, LOCALIZED_TEMPLATES, () => false);
  const template = templateOperations(`${area}/${name}`, generated.entries).filter(operation => operation.path !== `${area}/${name}`);
  const operations = [ ...(existingArea ? [] : [directory(area)]), directory(`${area}/${name}`), ...template.map(operation => operation.path === `${area}/${name}/matter.md` && operation.kind === "file" ? file(operation.path, (operation.content ?? "").replace("type: spis", `type: matter\nkind: ${request.kind}\narea: ${yaml(area)}\nsubject: ${yaml(request.subject ?? "")}`)) : operation) ];
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
  const target = join(cloneParent, `${safeSegment(inspection.root.split("/").pop() ?? "client")} (trial ${new Date().toISOString().slice(0, 10)})`);
  return { mode, appFiles: "inside", source: inspection.root, sourceDigest: inspection.digest, target, trial: true };
}
