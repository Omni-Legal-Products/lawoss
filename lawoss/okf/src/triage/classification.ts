/**
 * Klasifikácia od modelu je nedôveryhodný vstup. Model smie iba odkázať na dokumenty
 * inventára podľa `id`, zvoliť známu rolu a navrhnúť veci; nikdy neurčuje cestu.
 * Čokoľvek navyše alebo mimo limitov sa odmietne celé, nie potichu oreže.
 */
import { safeSegment } from "../onboarding/entities.ts";
import { TRIAGE_ROLES, type TriageRole } from "./rules.ts";
import { CLASSIFICATION_SCHEMA, type ModelDecision, type ModelMatter, type TriageClassification, type TriageInventory } from "./types.ts";

export class ClassificationError extends Error {}
const fail = (message: string): never => { throw new ClassificationError(`Neplatná klasifikácia: ${message}`); };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const MAX_MATTERS = 50;
const MAX_REASON = 300;

function strict(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${where}: nepovolené pole ${key}`);
}
/** Jeden riadok bez riadiacich znakov a bez úvodzoviek, aby sa hodnota nedala vložiť do YAML karty ako ďalší kľúč. */
export function cleanLine(value: unknown, where: string, max: number, required = false): string | undefined {
  if (value === undefined || value === null || value === "") { if (required) fail(`${where} chýba`); return undefined; }
  if (typeof value !== "string") return fail(`${where} musí byť text`);
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029"\\`]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned && required) fail(`${where} chýba`);
  if (cleaned.length > max) fail(`${where} je dlhšie ako ${max} znakov`);
  return cleaned || undefined;
}
export function isoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
const MATTER_KEY = /^[a-z0-9][a-z0-9_-]{0,31}$/;

function parseMatter(value: unknown, index: number): ModelMatter {
  const where = `matters[${index}]`;
  if (!record(value)) return fail(`${where} musí byť objekt`);
  strict(value, ["key", "title", "date", "kind", "area", "caseNumber", "counterparty", "court"], where);
  if (typeof value.key !== "string" || !MATTER_KEY.test(value.key) || value.key.startsWith("existing-")) fail(`${where}.key`);
  const title = cleanLine(value.title, `${where}.title`, 100, true)!;
  try { safeSegment(title); } catch { fail(`${where}.title nie je bezpečný názov priečinka`); }
  if (value.date !== undefined && (typeof value.date !== "string" || !isoDate(value.date))) fail(`${where}.date musí byť RRRR-MM-DD`);
  if (value.kind !== "contentious" && value.kind !== "non_contentious") fail(`${where}.kind`);
  const area = cleanLine(value.area, `${where}.area`, 80);
  if (area) { try { safeSegment(area); } catch { fail(`${where}.area`); } }
  return {
    key: value.key as string, title, kind: value.kind as ModelMatter["kind"],
    ...(typeof value.date === "string" ? { date: value.date } : {}),
    ...(area ? { area } : {}),
    ...optional("caseNumber", cleanLine(value.caseNumber, `${where}.caseNumber`, 60)),
    ...optional("counterparty", cleanLine(value.counterparty, `${where}.counterparty`, 200)),
    ...optional("court", cleanLine(value.court, `${where}.court`, 200)),
  };
}
const optional = <K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> => (value ? { [key]: value } as Record<K, string> : {});

function parseDecision(value: unknown, index: number, ids: ReadonlySet<string>, matterKeys: ReadonlySet<string>): ModelDecision {
  const where = `documents[${index}]`;
  if (!record(value)) return fail(`${where} musí byť objekt`);
  strict(value, ["id", "role", "matter", "confidence", "reason", "truncated"], where);
  if (typeof value.id !== "string" || !ids.has(value.id)) fail(`${where}.id nie je v inventári`);
  const role = TRIAGE_ROLES.find(item => item === value.role);
  if (!role) return fail(`${where}.role musí byť ${TRIAGE_ROLES.join(" | ")}`);
  if (value.matter !== undefined && value.matter !== null && (typeof value.matter !== "string" || !matterKeys.has(value.matter))) fail(`${where}.matter nie je známa vec`);
  if (value.confidence !== "high" && value.confidence !== "medium" && value.confidence !== "low") fail(`${where}.confidence`);
  if (value.truncated !== undefined && typeof value.truncated !== "boolean") fail(`${where}.truncated`);
  return {
    id: value.id as string, role: role as TriageRole, confidence: value.confidence as ModelDecision["confidence"],
    reason: cleanLine(value.reason, `${where}.reason`, MAX_REASON) ?? "",
    ...(typeof value.matter === "string" ? { matter: value.matter } : {}),
    ...(value.truncated === true ? { truncated: true } : {}),
  };
}

/** Overí klasifikáciu proti presnému inventáru. Iný strom klona = stará klasifikácia. */
export function parseClassification(value: unknown, inventory: Pick<TriageInventory, "treeDigest" | "documents" | "matters">): TriageClassification {
  if (!record(value)) return fail("koreň musí byť objekt");
  strict(value, ["schema", "treeDigest", "matters", "documents"], "koreň");
  if (value.schema !== CLASSIFICATION_SCHEMA) fail(`schema musí byť ${CLASSIFICATION_SCHEMA}`);
  if (value.treeDigest !== inventory.treeDigest) fail("treeDigest nezodpovedá aktuálnemu stavu klona; spusti scan znova");
  const rawMatters = value.matters ?? [];
  if (!Array.isArray(rawMatters) || rawMatters.length > MAX_MATTERS) fail(`matters musí byť zoznam do ${MAX_MATTERS} vecí`);
  const matters = (rawMatters as unknown[]).map(parseMatter);
  const keys = new Set<string>();
  for (const matter of matters) { if (keys.has(matter.key)) fail(`duplicitný kľúč veci ${matter.key}`); keys.add(matter.key); }
  const folders = new Set<string>();
  for (const matter of matters) { const folder = safeSegment(matter.title).toLocaleLowerCase(); if (folders.has(folder)) fail(`dve nové veci s rovnakým názvom ${matter.title}`); folders.add(folder); }
  const matterKeys = new Set([...keys, ...inventory.matters.map(matter => matter.id)]);
  if (!Array.isArray(value.documents) || value.documents.length > inventory.documents.length) fail("documents musí byť zoznam dokumentov z inventára");
  const ids = new Set(inventory.documents.map(document => document.id));
  const documents = (value.documents as unknown[]).map((item, index) => parseDecision(item, index, ids, matterKeys));
  const seen = new Set<string>();
  for (const decision of documents) { if (seen.has(decision.id)) fail(`dokument ${decision.id} je uvedený dvakrát`); seen.add(decision.id); }
  return { schema: CLASSIFICATION_SCHEMA, treeDigest: inventory.treeDigest, matters, documents };
}
