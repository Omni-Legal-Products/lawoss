import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { realpath } from "../canonical-path.ts";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { planClientConversion, type ClientConversionInput } from "./plan.ts";
import { inspectOnboardingRoot } from "./classify.ts";
import { executeCreate, planExistingClient, planNewClient, planNewMatter, planNewSubject, planOffice, planPracticeOffice, safeClientPattern, type AppFiles, type CreatePreview, type MapPreview, type PracticeRequest, type TrialClonePreview } from "./entities.ts";
import { applyTrialClone, recoverTrialClone } from "./trial-clone.ts";
import { recoverOnboardingPlan } from "./transaction.ts";
import { contained } from "../../../okf-pamat/src/workspace-memory-fs.ts";

export type OnboardingRequest =
  | { action: "office"; parent: string; title: string; jurisdiction: "sk" | "cz"; language: "sk" | "cs" | "en"; lawyerName: string; name?: string }
  | ({ action: "practice" } & PracticeRequest)
  | { action: "client"; parent: string; name: string; title: string; clientType: "fo" | "fo-podnikatel" | "po" | "iny"; jurisdiction: "sk" | "cz"; date: string; language: "sk" | "cs" | "en" }
  | { action: "subject"; clientRoot: string; name: string; title: string }
  | { action: "matter"; clientRoot: string; parent: string; title: string; date: string; kind: "contentious" | "non_contentious"; area: string; jurisdiction: "sk" | "cz"; subject?: string; language?: "sk" | "cs" | "en" }
  | ({ action: "existing"; root: string; mode: "convert" } & ClientConversionInput)
  | { action: "existing"; root: string; mode: "map"; memoryPath: string; identityAnchor: string }
  | ({ action: "existing"; root: string; mode: "trial_clone"; cloneParent: string } & ClientConversionInput);
export type OnboardingPreview = (CreatePreview & { action: "office" | "practice" | "client" | "subject" | "matter" | "existing" }) | (MapPreview & { action: "existing" }) | (TrialClonePreview & { action: "existing"; conversionPlan?: import("./transaction.ts").OnboardingPlan });
export type OnboardingApplyOptions = { journalDirectory: string; externalProfileDirectory: string };
export type OnboardingApplyResult = { root: string; clientRoot?: string; matterRoot?: string; appFiles: AppFiles; trial?: true; status?: "applied" | "already_applied" | "rolled_back" };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown, name: string) => { if (typeof value !== "string" || !value) throw new Error(`Invalid onboarding request field: ${name}`); return value; };
const optionalString = (value: unknown, name: string) => value === undefined ? undefined : string(value, name);
const isoDate = (value: unknown) => { const date = string(value, "date"); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Invalid date."); return date; };

async function externalProfileDirectory(clientRoot: string, input: string): Promise<string> {
  if (!isAbsolute(input)) throw new Error("External profile directory must be absolute.");
  const directory = resolve(input);
  const fromClient = relative(clientRoot, directory);
  if (fromClient !== ".." && !fromClient.startsWith(`..${sep}`) && !isAbsolute(fromClient)) {
    throw new Error("External profile directory must be outside the mapped client directory.");
  }
  let ancestor = directory;
  while (true) {
    try {
      if (await realpath(ancestor) !== ancestor || !(await lstat(ancestor)).isDirectory()) throw new Error("External profile directory must use a canonical directory path.");
      break;
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new Error("External profile directory has no existing canonical ancestor.");
      ancestor = parent;
    }
  }
  await mkdir(directory, { recursive: true });
  if (await realpath(directory) !== directory || !(await lstat(directory)).isDirectory()) throw new Error("External profile directory must use a canonical directory path.");
  return directory;
}

export function parseOnboardingRequest(value: unknown): OnboardingRequest {
  if (!record(value) || typeof value.action !== "string") throw new Error("Invalid onboarding request.");
  if (value.action === "office") {
    const jurisdiction = value.jurisdiction;
    if (jurisdiction !== "sk" && jurisdiction !== "cz") throw new Error("Invalid onboarding jurisdiction.");
    const language = value.language; if (language !== "sk" && language !== "cs" && language !== "en") throw new Error("Invalid language.");
    return { action: "office", parent: string(value.parent, "parent"), title: string(value.title, "title"), jurisdiction, language, lawyerName: string(value.lawyerName, "lawyerName"), name: optionalString(value.name, "name") };
  }
  if (value.action === "practice") {
    const jurisdiction = value.jurisdiction, language = value.language, scope = value.scope;
    if (jurisdiction !== "sk" && jurisdiction !== "cz") throw new Error("Invalid onboarding jurisdiction.");
    if (language !== "sk" && language !== "cs" && language !== "en") throw new Error("Invalid language.");
    if (scope !== "client" && scope !== "practice") throw new Error("Invalid workspace scope.");
    return { action: "practice", root: string(value.root, "root"), title: string(value.title, "title"), jurisdiction, language, lawyerName: string(value.lawyerName, "lawyerName"), clientPattern: safeClientPattern(string(value.clientPattern, "clientPattern")), scope };
  }
  if (value.action === "client") {
    const clientType = value.clientType, language = value.language;
    if (clientType !== "fo" && clientType !== "fo-podnikatel" && clientType !== "po" && clientType !== "iny") throw new Error("Invalid client type.");
    if (language !== undefined && language !== "sk" && language !== "cs" && language !== "en") throw new Error("Invalid language.");
    const jurisdiction = value.jurisdiction; if (jurisdiction !== "sk" && jurisdiction !== "cz") throw new Error("Invalid jurisdiction.");
    if (language !== "sk" && language !== "cs" && language !== "en") throw new Error("Invalid language.");
    return { action: "client", parent: string(value.parent, "parent"), name: string(value.name, "name"), title: string(value.title, "title"), clientType, jurisdiction, date: isoDate(value.date), language };
  }
  if (value.action === "subject") return { action: "subject", clientRoot: string(value.clientRoot, "clientRoot"), name: string(value.name, "name"), title: string(value.title, "title") };
  if (value.action === "matter") {
    const kind = value.kind, language = value.language;
    if (kind !== "contentious" && kind !== "non_contentious") throw new Error("Invalid matter kind.");
    if (language !== undefined && language !== "sk" && language !== "cs" && language !== "en") throw new Error("Invalid language.");
    const jurisdiction = value.jurisdiction; if (jurisdiction !== "sk" && jurisdiction !== "cz") throw new Error("Invalid jurisdiction.");
    return { action: "matter", clientRoot: string(value.clientRoot, "clientRoot"), parent: string(value.parent, "parent"), title: string(value.title, "title"), date: isoDate(value.date), kind, area: string(value.area, "area"), jurisdiction, subject: optionalString(value.subject, "subject"), language };
  }
  if (value.action === "existing") {
    if (value.mode === "map") return { action: "existing", root: string(value.root, "root"), mode: "map", memoryPath: string(value.memoryPath, "memoryPath"), identityAnchor: string(value.identityAnchor, "identityAnchor") };
    if (value.mode === "trial_clone") {
      const clientType = value.clientType, language = value.language, jurisdiction = value.jurisdiction;
      if (clientType !== "fo" && clientType !== "fo-podnikatel" && clientType !== "po" && clientType !== "iny") throw new Error("Invalid client type.");
      if (language !== "sk" && language !== "cs" && language !== "en") throw new Error("Invalid language.");
      if (jurisdiction !== "sk" && jurisdiction !== "cz") throw new Error("Invalid jurisdiction.");
      return { action: "existing", root: string(value.root, "root"), mode: "trial_clone", cloneParent: string(value.cloneParent, "cloneParent"), title: string(value.title, "title"), clientType, language, jurisdiction, date: isoDate(value.date), confirmUnknownClient: value.confirmUnknownClient === true };
    }
    if (value.mode === "convert") {
      const clientType = value.clientType, language = value.language, jurisdiction = value.jurisdiction;
      if (clientType !== "fo" && clientType !== "fo-podnikatel" && clientType !== "po" && clientType !== "iny") throw new Error("Invalid client type.");
      if (language !== "sk" && language !== "cs" && language !== "en") throw new Error("Invalid language.");
      if (jurisdiction !== "sk" && jurisdiction !== "cz") throw new Error("Invalid jurisdiction.");
      return { action: "existing", root: string(value.root, "root"), mode: "convert", title: string(value.title, "title"), clientType, language, jurisdiction, date: isoDate(value.date), confirmUnknownClient: value.confirmUnknownClient === true };
    }
    throw new Error("Invalid existing-client mode.");
  }
  throw new Error("Invalid onboarding action.");
}
export async function planOnboarding(request: OnboardingRequest): Promise<OnboardingPreview> {
  if (request.action === "office") return { action: request.action, ...await planOffice(request) };
  if (request.action === "practice") return { action: request.action, ...await planPracticeOffice(request) };
  if (request.action === "client") return { action: request.action, ...await planNewClient(request) };
  if (request.action === "subject") return { action: request.action, ...await planNewSubject(request) };
  if (request.action === "matter") { const client = await realpath(request.clientRoot), parent = await realpath(request.parent); if (!contained(client, parent)) throw new Error("Matter parent must be within client root."); return { action: request.action, ...await planNewMatter(request) }; }
  if (request.mode === "convert") { const preview = await planClientConversion(request.root, request); return { action: "existing", mode: "new", appFiles: "inside", target: request.root, clientRoot: request.root, plan: preview.plan }; }
  const preview = await planExistingClient(request.root, request.mode, request.mode === "trial_clone" ? request.cloneParent : undefined, request.mode === "map" ? request : undefined);
  if (request.mode === "trial_clone") {
    if (preview.mode !== "trial_clone") throw new Error("Trial clone planner returned an invalid mode.");
    const conversion = await planClientConversion(request.root, request);
    return { action: request.action, ...preview, conversionPlan: conversion.plan };
  }
  return { action: request.action, ...preview };
}
export async function applyOnboarding(preview: OnboardingPreview, options: OnboardingApplyOptions): Promise<OnboardingApplyResult> {
  if (preview.mode === "map") {
    const inspection = await inspectOnboardingRoot(preview.root);
    if (!inspection.complete || inspection.digest !== preview.sourceDigest) throw new Error("Mapped client changed since planning.");
    const directory = await externalProfileDirectory(preview.root, options.externalProfileDirectory);
    const path = join(directory, "memory-profile.json"), content = JSON.stringify(preview.externalProfile);
    try { await writeFile(path, content, { flag: "wx" }); }
    catch (error) { if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST" || await readFile(path, "utf8") !== content) throw error; }
    return { root: preview.root, clientRoot: preview.root, appFiles: "outside" };
  }
  if (preview.mode === "trial_clone") { await applyTrialClone(preview, options.journalDirectory); return { root: preview.target, clientRoot: preview.target, appFiles: "inside", trial: true }; }
  const result = await executeCreate(preview, options.journalDirectory);
  return { root: preview.target, clientRoot: preview.clientRoot, matterRoot: preview.action === "matter" ? preview.target : undefined, appFiles: "inside", status: result.status };
}
export async function recoverOnboarding(preview: OnboardingPreview, options: OnboardingApplyOptions, action: "finish" | "rollback"): Promise<OnboardingApplyResult> {
  if (preview.mode === "map") throw new Error("Map onboarding has no recoverable filesystem transaction.");
  if (preview.mode === "trial_clone") { await recoverTrialClone(preview, options.journalDirectory, action); return { root: preview.target, clientRoot: preview.target, appFiles: "inside", trial: true }; }
  const result = await recoverOnboardingPlan(preview.plan, options.journalDirectory, action);
  return { root: preview.target, clientRoot: preview.clientRoot, matterRoot: preview.action === "matter" ? preview.target : undefined, appFiles: "inside", status: result.status };
}
