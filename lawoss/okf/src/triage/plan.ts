/**
 * Plán roztriedenia z inventára, pravidiel a voliteľnej klasifikácie modelom.
 * Bez súborového systému: rovnaký inventár a vstupy dajú rovnaký plán (okrem runId a času).
 */
import { createHash } from "node:crypto";
import { buildMatterOperations } from "../onboarding/entities.ts";
import type { CreateOperation } from "../onboarding/transaction.ts";
import { parseWorkingProfile, PROFILE_FILE } from "../profile.ts";
import { classifyByRules, findCaseNumber, type Confidence, type RuleResult, type TriageRole } from "./rules.ts";
import { PLAN_SCHEMA, type MoveSource, type TriageClassification, type TriageDocument, type TriageInventory, type TriageMove, type TriageNewMatter, type TriagePlan, type TriageStay } from "./types.ts";

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
/** Odtlačok plánu je SHA-256 jeho obsahu bez samotného odtlačku; viaže náhľad, ktorý človek potvrdil. */
export function planFingerprint(plan: Omit<TriagePlan, "fingerprint"> & { fingerprint?: string }): string {
  const { fingerprint: _ignored, ...rest } = plan;
  return sha256(JSON.stringify(rest));
}

const MATTER_TITLE: Record<"sk" | "cs" | "en", string> = { sk: "Konanie", cs: "Řízení", en: "Proceedings" };
const MATTER_AREA: Record<"sk" | "cs" | "en", string> = { sk: "Súdne konanie", cs: "Soudní řízení", en: "Litigation" };
const GENERAL_AREA: Record<"sk" | "cs" | "en", string> = { sk: "Všeobecné", cs: "Obecné", en: "General" };
const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"];
/** Pravidlá zakladajú vec zo spisovej značky len vtedy, keď ju nesú aspoň dva dokumenty. */
const RULE_MATTER_MIN_DOCUMENTS = 2;

type Decision = { role: TriageRole | null; matter?: string; source: MoveSource; confidence: Confidence; rule?: RuleResult["rule"]; matched?: string; reason?: string; truncated?: boolean };
type Destination = { base: string; roles: Record<string, string> };

/** `leaveInPlace`: kľúče existujúcich priečinkov (prípadov bez karty), ktoré advokát v náhľade odškrtol; ostanú nedotknuté. */
export type BuildOptions = { classification?: TriageClassification; keepInInbox?: readonly string[]; leaveInPlace?: readonly string[]; today: string; runId: string; createdAt: string };

function splitName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: "" };
}

/** Dôležitá pošta bez vlastnej roly patrí aspoň do komunikácie; ostatné bez roly do priečinka na zatriedenie. */
function resolveFolder(roles: Record<string, string>, role: TriageRole): { role: TriageRole; folder: string } | null {
  for (const candidate of role === "important_mail" ? ["important_mail", "correspondence", "inbox"] as const : [role, "inbox"] as const) {
    const folder = roles[candidate];
    if (folder) return { role: candidate, folder };
  }
  return null;
}

export function buildTriagePlan(inventory: TriageInventory, options: BuildOptions): TriagePlan {
  const language = inventory.language;
  const keep = new Set(options.keepInInbox ?? []);
  const leave = new Set((options.leaveInPlace ?? []).filter(key => inventory.matters.some(matter => matter.implicit && matter.id === key)));
  const model = new Map((options.classification?.documents ?? []).map(decision => [decision.id, decision]));
  const decisions = new Map<string, Decision>();
  const caseGroups = new Map<string, { display: string; ids: string[] }>();
  // Dokument vo veci bez karty (`document.matter`) v nej ostáva: ani model, ani spisová značka ho z nej nevyberú.
  for (const document of inventory.documents) {
    const fromModel = model.get(document.id);
    if (fromModel) {
      // Nejasné od modelu ide na zatriedenie aj s jeho dôvodom, aby advokát videl, čo model zvažoval.
      decisions.set(document.id, { role: fromModel.confidence === "low" ? "inbox" : fromModel.role, matter: document.matter ?? fromModel.matter, source: "model", confidence: fromModel.confidence, reason: fromModel.reason, ...(fromModel.truncated ? { truncated: true } : {}) });
      continue;
    }
    const rule = classifyByRules(document);
    decisions.set(document.id, { role: rule.role, source: "rules", confidence: rule.confidence, rule: rule.rule, ...(rule.matched ? { matched: rule.matched } : {}), ...(document.matter ? { matter: document.matter } : {}) });
    if (rule.caseNumber && !document.matter) {
      const group = caseGroups.get(rule.caseNumber.key) ?? { display: rule.caseNumber.display, ids: [] };
      group.ids.push(document.id);
      caseGroups.set(rule.caseNumber.key, group);
    }
  }

  // Nové veci: najprv od modelu, potom zo spisových značiek dokumentov, ktoré model nezaradil.
  type Planned = TriageNewMatter & { operations: CreateOperation[]; roles: Record<string, string> };
  const planned: Planned[] = [];
  const takenFolders = new Set(inventory.occupied.map(path => path.toLocaleLowerCase()));
  const addMatter = (input: { key: string; title: string; date?: string; kind: TriageNewMatter["kind"]; area?: string; caseNumber?: string; counterparty?: string; court?: string; source: "rules" | "model" }) => {
    const date = input.date ?? options.today;
    let title = input.title;
    let built = buildMatterOperations({ title, date, kind: input.kind, area: input.area ?? MATTER_AREA[language], jurisdiction: inventory.jurisdiction, language, workingProfile: inventory.newMatterProfile, clientTitle: inventory.client.title, clientCardPath: `../../${inventory.client.card}`, extras: { caseNumber: input.caseNumber, counterparty: input.counterparty, court: input.court } });
    // Existujúci priečinok s rovnakým menom sa nikdy nepoužije ani neprepíše; nová vec dostane poradové číslo.
    for (let n = 2; takenFolders.has(built.folder.toLocaleLowerCase()); n++) {
      title = `${input.title} (${n})`;
      built = buildMatterOperations({ title, date, kind: input.kind, area: input.area ?? MATTER_AREA[language], jurisdiction: inventory.jurisdiction, language, workingProfile: inventory.newMatterProfile, clientTitle: inventory.client.title, clientCardPath: `../../${inventory.client.card}`, extras: { caseNumber: input.caseNumber, counterparty: input.counterparty, court: input.court } });
    }
    takenFolders.add(built.folder.toLocaleLowerCase());
    for (const operation of built.operations) takenFolders.add(operation.path.toLocaleLowerCase());
    const profile = built.operations.find(operation => operation.path === `${built.folder}/${PROFILE_FILE}`);
    const roles = profile?.content ? parseWorkingProfile(profile.content).roles : {};
    planned.push({ key: input.key, title, folder: built.folder, date, dateSource: input.date ? "model" : "today", kind: input.kind, area: input.area ?? MATTER_AREA[language], jurisdiction: inventory.jurisdiction, ...(input.caseNumber ? { caseNumber: input.caseNumber } : {}), ...(input.counterparty ? { counterparty: input.counterparty } : {}), ...(input.court ? { court: input.court } : {}), source: input.source, documents: 0, operations: built.operations, roles });
  };
  for (const matter of options.classification?.matters ?? []) addMatter({ ...matter, source: "model" });
  for (const [caseKey, group] of [...caseGroups].sort(([a], [b]) => a.localeCompare(b))) {
    const existing = inventory.matters.find(matter => matter.caseKey === caseKey);
    const fromModel = planned.find(matter => matter.caseNumber && findCaseNumber(matter.caseNumber)?.key === caseKey);
    let key = existing?.id ?? fromModel?.key;
    if (!key && group.ids.length >= RULE_MATTER_MIN_DOCUMENTS) {
      key = `case-${sha256(caseKey).slice(0, 8)}`;
      addMatter({ key, title: `${MATTER_TITLE[language]} ${group.display.replace(/\//g, "-")}`, kind: "contentious", caseNumber: group.display, source: "rules" });
    }
    if (key) for (const id of group.ids) { const decision = decisions.get(id); if (decision) decision.matter = key; }
  }
  const homes = new Map(inventory.documents.map(document => [document.id, document.matter]));
  for (const id of keep) { const decision = decisions.get(id); if (decision) Object.assign(decision, { role: "inbox", matter: homes.get(id), source: "user", confidence: "high" }); }

  const destinations = new Map<string, Destination>([["", { base: "", roles: inventory.profile.roles }]]);
  for (const matter of inventory.matters) destinations.set(matter.id, { base: matter.path, roles: matter.roles });
  for (const matter of planned) destinations.set(matter.key, { base: matter.folder, roles: matter.roles });

  const occupied = new Set(inventory.occupied.map(path => path.toLocaleLowerCase()));
  const needsMattersDir = planned.length > 0 && !occupied.has("spisy");
  // Vec bez karty dostane kartu a pracovné priečinky na mieste. Existujúce sa nikdy neprepíše: chýba len to,
  // čo v priečinku ešte nie je. Pri vlastných inštrukciách alebo pracovnom profile veci sa doplní len karta.
  const adopted = inventory.matters.filter(matter => matter.implicit).map(matter => {
    const title = matter.title ?? matter.path;
    // Odškrtnutý priečinok: v náhľade ostane (aby sa dal znova zaškrtnúť), ale nedostane kartu, priečinky ani presuny.
    if (leave.has(matter.id)) return { entry: { key: matter.id, title, folder: matter.path, date: options.today, dateSource: "today" as const, kind: "non_contentious" as const, area: GENERAL_AREA[language], jurisdiction: inventory.jurisdiction, source: "folder" as const, documents: 0, left: true as const }, operations: [] };
    const caseNumber = matter.implicit?.caseNumber;
    const kind: TriageNewMatter["kind"] = caseNumber ? "contentious" : "non_contentious";
    const area = caseNumber ? MATTER_AREA[language] : GENERAL_AREA[language];
    const built = buildMatterOperations({ title: matter.title ?? matter.path, date: options.today, kind, area, jurisdiction: inventory.jurisdiction, language, workingProfile: inventory.newMatterProfile, clientTitle: inventory.client.title, clientCardPath: `../${inventory.client.card}`, folder: matter.path, extras: { caseNumber } });
    const has = (name: string) => occupied.has(`${matter.path}/${name}`.toLocaleLowerCase());
    const ownProfile = has(PROFILE_FILE), ownInstructions = INSTRUCTION_FILES.some(has);
    const operations = built.operations.filter(operation => {
      const rest = operation.path.slice(matter.path.length + 1);
      if (!rest || occupied.has(operation.path.toLocaleLowerCase())) return false;
      if (ownInstructions && INSTRUCTION_FILES.includes(rest)) return false;
      if (ownProfile && rest.includes("/")) return false;
      // `.keep` drží len priečinok, ktorý vznikne; do existujúceho priečinka advokáta sa nepridáva.
      return !(rest.endsWith("/.keep") && occupied.has(operation.path.slice(0, -"/.keep".length).toLocaleLowerCase()));
    });
    const entry: TriageNewMatter = { key: matter.id, title: matter.title ?? matter.path, folder: matter.path, date: options.today, dateSource: "today", kind, area, jurisdiction: inventory.jurisdiction, ...(caseNumber ? { caseNumber } : {}), source: "folder", documents: 0 };
    return { entry, operations };
  });
  // Cesty nových vecí sa správajú ako existujúce: ich priečinky vytvorí šablóna veci, nie tento plán.
  for (const matter of [...planned, ...adopted]) for (const operation of matter.operations) occupied.add(operation.path.toLocaleLowerCase());
  if (needsMattersDir) occupied.add("spisy");
  const claimed = new Set<string>();
  const extraDirectories: CreateOperation[] = [];
  const ensureDirectory = (path: string) => {
    if (!path || occupied.has(path.toLocaleLowerCase())) return;
    ensureDirectory(path.split("/").slice(0, -1).join("/"));
    occupied.add(path.toLocaleLowerCase());
    extraDirectories.push({ path, kind: "directory" });
  };
  const moves: TriageMove[] = [];
  const stays: TriageStay[] = [];
  const used = new Set<string>();
  for (const document of inventory.documents) {
    if (document.matter && leave.has(document.matter)) continue;
    const decision = decisions.get(document.id)!;
    const destination = destinations.get(decision.matter ?? "") ?? destinations.get("")!;
    const requested: TriageRole = decision.role ?? "inbox";
    const primary = resolveFolder(destination.roles, requested);
    // Dokument z veci sa nikdy nepresunie na úroveň klienta; bez priečinka vo veci ostane, kde je.
    const target = primary ?? (destination.base && !document.matter ? resolveFolder(inventory.profile.roles, "inbox") : null);
    if (!target) { stays.push({ id: document.id, path: document.path, why: "no_inbox" }); continue; }
    const base = primary ? destination.base : "";
    const folder = base ? `${base}/${target.folder}` : target.folder;
    if (document.path.split("/").slice(0, -1).join("/") === folder) { stays.push({ id: document.id, path: document.path, why: target.role === "inbox" ? "unclear" : "already_in_place" }); continue; }
    const { stem, ext } = splitName(document.name);
    let to = `${folder}/${document.name}`;
    for (let n = 2; occupied.has(to.toLocaleLowerCase()) || claimed.has(to.toLocaleLowerCase()); n++) to = `${folder}/${stem} (${n})${ext}`;
    claimed.add(to.toLocaleLowerCase());
    ensureDirectory(folder);
    if (decision.matter && base) used.add(decision.matter);
    const fallback = target.role !== requested || (base === "" && destination.base !== "");
    moves.push({
      id: document.id, from: document.path, to, size: document.size, sha256: document.sha256,
      role: target.role, ...(decision.matter && base ? { matter: decision.matter } : {}),
      source: fallback ? "fallback" : decision.source, confidence: decision.confidence,
      ...(decision.rule ? { rule: decision.rule } : {}), ...(decision.matched ? { matched: decision.matched } : {}),
      ...(decision.reason ? { reason: decision.reason } : {}), ...(decision.truncated ? { truncated: true } : {}),
      ...(to !== `${folder}/${document.name}` ? { renamed: true } : {}),
    });
  }
  // Vec bez jediného dokumentu sa nezakladá; nevznikne prázdna karta, ktorú by advokát musel mazať.
  const kept = planned.filter(matter => used.has(matter.key));
  for (const matter of [...kept, ...adopted.map(item => item.entry)]) if (!("left" in matter)) matter.documents = moves.filter(move => move.matter === matter.key).length;
  const create: CreateOperation[] = [
    ...(needsMattersDir && kept.length ? [{ path: "Spisy", kind: "directory" as const }] : []),
    ...kept.flatMap(matter => matter.operations),
    ...adopted.flatMap(matter => matter.operations),
    ...extraDirectories,
  ];
  const plan: Omit<TriagePlan, "fingerprint"> = {
    schema: PLAN_SCHEMA, runId: options.runId, root: inventory.root, treeDigest: inventory.treeDigest, createdAt: options.createdAt, language,
    classification: options.classification ? { used: true, digest: sha256(JSON.stringify(options.classification)), documents: options.classification.documents.length } : { used: false, documents: 0 },
    matters: [...kept.map(({ operations: _operations, roles: _roles, ...matter }) => matter), ...adopted.map(matter => matter.entry)],
    create, moves, stays,
  };
  return { ...plan, fingerprint: planFingerprint(plan) };
}

export type { TriageDocument };
