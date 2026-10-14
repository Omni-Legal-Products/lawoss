import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rename, rm, writeFile, link } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import { within } from "../../reviews/storage.js";
import type { WorkspaceInfo } from "../../types.js";
import type { DocumentEvidence } from "./types.js";
import type { LawossDocuments } from "./service.js";
import { outputLanguageSchema, SUMMARY_LABELS as labels, parseSavedSummary, renderSummaryVisible, summaryIdentityHeader, summaryRows, sidecarSchema, type SummaryData, type OutputIdentity, CSV_HEADER, parseCsv, serializeCsv, type ValidationIssue, type ValidationResult } from "./validation.js";
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export { outputLanguageSchema } from "./validation.js";
const ids = z.array(z.string().uuid()).min(1).max(20);
const pathSchema = z.string().min(1).max(4096);
export const exportInputSchema = z.strictObject({ path: pathSchema, kind: z.enum(["registry", "summary"]), outputLanguage: outputLanguageSchema, documentIds: ids, expectedHash: hashSchema.optional(), entries: z.array(z.strictObject({ documentId: z.string().uuid(), summary: z.string().max(12000), date: z.string().max(100).optional(), type: z.string().max(200).optional() })).max(20) });
export const validateInputSchema = z.strictObject({ paths: z.array(pathSchema).min(1).max(10), documentIds: ids, outputLanguage: outputLanguageSchema });
export type ExportInput = z.infer<typeof exportInputSchema>;
export type ValidateInput = z.infer<typeof validateInputSchema>;
export type OutputStatus = {
  sourceKind: "isir" | "workspace";
  path: string;
  kind: "registry" | "summary";
  outputLanguage: z.infer<typeof outputLanguageSchema>;
  documentIds: string[];
  identity: {
    caseNumber: string | null;
    company: string | null;
    sourceUrl: string | null;
    project: string;
  };
  hash: string;
  currentHash: string | null;
  sourceHash: string;
  currentSourceHash: string | null;
  owned: boolean;
  verified: boolean;
  legalApproval: false;
};
export type OutputList = {
  outputs: OutputStatus[];
  nextOffset: number | null;
  legalApproval: false;
};
export type ExportResult = {
  sourceKind: "isir" | "workspace";
  path: string;
  hash: string;
  verified: false;
  kind: "registry" | "summary";
  outputLanguage: z.infer<typeof outputLanguageSchema>;
  legalApproval: false;
};
const manifestSchema = z.object({ source: z.string().min(1).max(200), company: z.string().min(1).max(500), caseNumber: z.string().min(1).max(200), sourceUrl: z.string().url().max(2048), sampleOnly: z.boolean(), documents: z.array(z.object({ file: pathSchema, documentId: z.string().min(1).max(200), url: z.string().url().max(2048), sha256: hashSchema })).min(1).max(500) });
/** Output ownership is persisted by the document service, not inferred from filenames. */
export class DocumentExports {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly documents: LawossDocuments) { }
  private lock<T>(action: () => Promise<T>): Promise<T> { const result = this.pending.then(action); this.pending = result.catch(() => { }); return result; }
  private async file(workspace: WorkspaceInfo, path: string, maxBytes = 4 * 1024 * 1024) {
    const root = await realpath(workspace.path), requested = resolve(root, path);
    if (!within(root, requested) || requested === root)
      throw new ApiError(403, "output_path", "Output must be inside the selected project.");
    const parent = await realpath(dirname(requested));
    if (!within(root, parent))
      throw new ApiError(403, "output_path", "Output parent escapes the project.");
    try {
      const info = await lstat(requested);
      if (info.isSymbolicLink() || !info.isFile() || info.size > maxBytes)
        throw new ApiError(400, "output_file", "Output must be a regular file under 4 MiB.");
    }
    catch (error) {
      if (!isMissing(error))
        throw error;
    }
    return { absolute: requested, path: relative(root, requested).replaceAll("\\", "/") };
  }
  // Source aliases may resolve inside the selected workspace. Output ownership
  // still uses file(), which deliberately refuses symlink outputs.
  private async sourceFile(workspace: WorkspaceInfo, path: string) {
    const root = await realpath(workspace.path), requested = resolve(root, path);
    if (!within(root, requested) || requested === root)
      throw new Error("Reference source escapes the selected project.");
    const absolute = await realpath(requested);
    if (!within(root, absolute) || absolute === root)
      throw new Error("Reference source alias escapes the selected project.");
    const info = await lstat(absolute);
    if (!info.isFile() || info.size > 64 * 1024 * 1024)
      throw new Error("Reference source must be a bounded regular file.");
    return absolute;
  }
  private async reference(workspace: WorkspaceInfo, record: DocumentEvidence, references: z.infer<typeof manifestSchema>["documents"]) {
    const selected = await this.sourceFile(workspace, record.path);
    if (sha(await readFile(selected)) !== record.hash)
      throw new Error("Selected source hash differs.");
    const root = await realpath(workspace.path);
    let candidates = references.filter(d => resolve(root, d.file) === resolve(root, record.path));
    if (!candidates.length) {
      // A listed canonical alias with a wrong hash must not borrow another
      // reference merely because that other file has the selected hash.
      for (const reference of references) {
        try {
          if (await this.sourceFile(workspace, reference.file) === selected) candidates.push(reference);
        } catch (error) {
          if (reference.sha256 === record.hash) throw error;
        }
      }
      if (!candidates.length) candidates = references.filter(d => d.sha256 === record.hash);
    }
    const identities = new Set(candidates.map(d => JSON.stringify([d.documentId, d.url, d.sha256])));
    if (!candidates.length || identities.size !== 1 || candidates.some(d => d.sha256 !== record.hash))
      throw new Error("Source reference is missing, mismatched or ambiguous in selected manifest.");
    const reference = candidates[0];
    const original = await this.sourceFile(workspace, reference.file);
    if (sha(await readFile(original)) !== reference.sha256)
      throw new Error("Manifest source hash differs.");
    return reference;
  }
  private async context(workspace: WorkspaceInfo, documentIds: string[]) {
    await realpath(workspace.path);
    let sourceKind: "isir" | "workspace" = "workspace", manifestHash: string | null = null;
    let manifest: {
      source: string;
      company: string | null;
      caseNumber: string | null;
      sourceUrl: string | null;
      sampleOnly: boolean;
      documents: z.infer<typeof manifestSchema>["documents"];
    } = { source: "workspace", company: null, caseNumber: null, sourceUrl: null, sampleOnly: false, documents: [] };
    try {
      const file = await this.file(workspace, "TEST_ZDROJE_ISIR.json"), raw = await readFile(file.absolute);
      const known = manifestSchema.parse(JSON.parse(raw.toString("utf8")));
      const official = (url: string) => { const parsed = new URL(url); return parsed.protocol === "https:" && parsed.hostname === "isir.justice.cz"; };
      if (!official(known.sourceUrl) || known.documents.some(d => !official(d.url)))
        throw new Error("Manifest requires official ISIR URLs.");
      manifest = known;
      manifestHash = sha(raw);
      sourceKind = "isir";
    }
    catch (error) {
      if (!isMissing(error))
        throw error;
    }
    const all = await this.documents.list(workspace), selected: Array<{
      record: DocumentEvidence;
      reference: z.infer<typeof manifestSchema>["documents"][number];
      children: DocumentEvidence[];
    }> = [];
    for (const id of new Set(documentIds)) {
      const record = await this.documents.evidence(workspace, id);
      if (record.provenance.parentId)
        throw new Error("Select original sources; attachment citations remain separate.");
      const reference = sourceKind === "isir" ? await this.reference(workspace, record, manifest.documents) : { file: record.path, documentId: record.id, url: "", sha256: record.hash };
      const sourceFile = await this.sourceFile(workspace, reference.file);
      if (sha(await readFile(sourceFile)) !== reference.sha256)
        throw new Error("Manifest source hash differs.");
      if (sourceKind === "isir" && selected.some(item => item.record.hash === record.hash && (item.reference.documentId !== reference.documentId || item.reference.url !== reference.url)))
        throw new Error("Selected identical bytes have ambiguous official references.");
      const children: DocumentEvidence[] = [];
      const descendants = new Set([id]);
      for (const item of all)
        if (item.provenance.parentId && descendants.has(item.provenance.parentId)) {
          children.push(await this.documents.evidence(workspace, item.id));
          descendants.add(item.id);
        }
      if (!selected.some(item => item.reference.documentId === reference.documentId || item.record.hash === record.hash))
        selected.push({ record, reference, children });
    }
    const fingerprint = sha(JSON.stringify({ manifest: manifestHash, sourceKind, workspace: { id: workspace.id, name: workspace.name }, sources: selected.map(x => ({ id: x.reference.documentId, hash: x.record.hash, complete: x.record.complete, issue: x.record.issue, pages: x.record.pages, children: x.children.map(c => ({ hash: c.hash, provenance: c.provenance, complete: c.complete, issue: c.issue, pages: c.pages })) })) }));
    return { manifest, selected, fingerprint, sourceKind };
  }
  async export(workspace: WorkspaceInfo, input: ExportInput): Promise<ExportResult> {
    return this.lock(async () => {
      input = exportInputSchema.parse(input);
      if (!input.path.endsWith(input.kind === "registry" ? ".csv" : ".md"))
        throw new ApiError(400, "output_extension", "Use .csv for registry or .md for summary.");
      const context = await this.context(workspace, input.documentIds), file = await this.file(workspace, input.path), label = labels[input.outputLanguage];
      const stored = await this.documents.outputRecord(workspace, file.path);
      let current: string | undefined;
      try {
        current = sha(await readFile(file.absolute));
      }
      catch (error) {
        if (!isMissing(error))
          throw error;
      }
      if (current !== undefined && (!stored?.owned || stored.hash !== current || input.expectedHash !== current))
        throw new ApiError(409, "output_conflict", "Existing output is user-owned or changed; choose a new path or supply its current registered hash.");
      if (current === undefined && input.expectedHash !== undefined)
        throw new ApiError(409, "output_conflict", "Expected output no longer exists.");
      if (input.entries.some(e => !input.documentIds.includes(e.documentId)) || new Set(input.entries.map(e => e.documentId)).size !== input.entries.length)
        throw new Error("Entries must uniquely reference selected prepared sources.");
      const identity = { caseNumber: context.manifest.caseNumber, company: context.manifest.company, sourceUrl: context.manifest.sourceUrl, project: workspace.name };
      const rows = context.selected.map(({ record, reference, children }) => { const entry = input.entries.find(e => e.documentId === record.id); return [reference.file, reference.documentId, reference.url, entry?.date ?? label.unknown, entry?.type ?? label.unknown, entry?.summary ?? label.unknown, JSON.stringify(coverage(record, children))]; });
      const data: SummaryData = {
        identity, sourceKind: context.sourceKind, outputLanguage: input.outputLanguage, legalApproval: false,
        sources: rows.slice().map(row => ({ file: row[0], documentId: row[1], url: row[2], date: row[3], type: row[4], summary: row[5], coverage: JSON.parse(row[6]) })),
      };
      const serialized = JSON.stringify({ ...data, heading: label.summary, coverageLabel: label.coverage }, null, 2) + "\n";
      const content = input.kind === "summary" ? `${renderSummaryVisible(data)}\`\`\`json\n${serialized}\`\`\`\n` : serializeCsv([CSV_HEADER, ...rows]);
      if (Buffer.byteLength(content) > 4 * 1024 * 1024)
        throw new Error("Output exceeds 4 MiB.");
      const temp = join(dirname(file.absolute), `.lawoss-${randomUUID()}.tmp`);
      try {
        await writeFile(temp, content, { flag: "wx", mode: 0o600 });
        if ((await this.context(workspace, input.documentIds)).fingerprint !== context.fingerprint)
          throw new Error("Sources changed during export.");
        const latest = await this.file(workspace, file.path);
        if (current !== undefined) {
          if (sha(await readFile(latest.absolute)) !== current)
            throw new Error("Output changed during export.");
          await rename(temp, latest.absolute);
        }
        else {
          await link(temp, latest.absolute);
          await rm(temp);
        }
        const savedHash = sha(await readFile(file.absolute));
        if (savedHash !== sha(content))
          throw new Error("Published output changed before registration.");
        const result: ExportResult = { sourceKind: context.sourceKind, path: file.path, hash: savedHash, verified: false, kind: input.kind, outputLanguage: input.outputLanguage, legalApproval: false };
        await this.documents.saveOutputRecord(workspace, { ...result, owned: true, identityPath: null, identityHash: null, documentIds: [...new Set(input.documentIds)], identity, sourceHash: context.fingerprint, verifiedHash: null });
        return result;
      }
      finally {
        await rm(temp, { force: true });
      }
    });
  }
  async list(workspace: WorkspaceInfo, offset = 0, limit = 20): Promise<OutputList> {
    z.number().int().min(0).max(500).parse(offset);
    z.number().int().min(1).max(20).parse(limit);
    const records = await this.documents.outputRecords(workspace);
    const outputs: OutputStatus[] = [];
    for (const record of records.slice(offset, offset + limit)) {
      const inspection = await this.inspect(workspace, record.path);
      const currentHash = inspection.hash;
      let currentSourceHash: string | null = null;
      let context: SourceContext | undefined;
      let representationCurrent = inspection.issues.length === 0;
      if (inspection.summary)
        representationCurrent = representationCurrent && isDeepStrictEqual(inspection.identity, record.identity)
          && inspection.language === record.outputLanguage
          && (!inspection.summary.sourceKind || inspection.summary.sourceKind === record.sourceKind);
      let identityCurrent = true;
      try {
        context = await this.context(workspace, record.documentIds);
        currentSourceHash = context.fingerprint;
        // Historical receipts are not sufficient when their saved coverage
        // cannot satisfy the current validator, even if no bytes changed.
        validateRows(inspection, context);
        if (inspection.summary) validateIdentity(inspection, context, workspace, record.outputLanguage);
        representationCurrent = representationCurrent && inspection.issues.length === 0;
      }
      catch { /* Stale sources are unverified. */ }
      if (record.identityPath) {
        try {
          const file = await this.file(workspace, record.identityPath);
          const bytes = await readFile(file.absolute);
          identityCurrent = sha(bytes) === record.identityHash;
          if (file.path.endsWith(".md") || file.path.endsWith(".json") && !file.path.endsWith(".lawoss.json")) {
            identityCurrent = identityCurrent && savedSummaryMatches(file.path, bytes.toString("utf8"), record.identity, record.outputLanguage, record.sourceKind);
            const companion = await this.inspect(workspace, file.path);
            validateRows(companion, context);
            identityCurrent = identityCurrent && companion.issues.length === 0;
          }
        }
        catch {
          identityCurrent = false;
        }
      }
      outputs.push({
        sourceKind: record.sourceKind, path: record.path, kind: record.kind, outputLanguage: record.outputLanguage, documentIds: record.documentIds, identity: record.identity,
        hash: record.hash, currentHash, sourceHash: record.sourceHash, currentSourceHash, owned: record.owned,
        verified: representationCurrent && identityCurrent && currentHash !== null && currentHash === record.verifiedHash && currentSourceHash === record.sourceHash, legalApproval: false,
      });
    }
    const end = Math.min(records.length, offset + limit);
    return { outputs, nextOffset: end < records.length ? end : null, legalApproval: false };
  }
  private async inspect(workspace: WorkspaceInfo, path: string): Promise<OutputInspection> {
    const inspection: OutputInspection = { path, absolute: null, hash: null, stored: undefined, rows: [], identity: undefined, language: undefined, summary: undefined, identityPath: null, identityHash: null, issues: [] };
    try {
      const file = await this.file(workspace, path);
      inspection.path = file.path;
      inspection.absolute = file.absolute;
      const bytes = await readFile(file.absolute);
      inspection.hash = sha(bytes);
      inspection.stored = await this.documents.outputRecord(workspace, file.path);
      if (file.path.endsWith(".json") || file.path.endsWith(".md")) {
        const parsed = parseSavedSummary(file.path, bytes.toString("utf8"));
        inspection.summary = parsed.data;
        inspection.identity = parsed.data.identity;
        inspection.language = parsed.data.outputLanguage;
        inspection.rows = summaryRows(parsed.data);
        if (parsed.visible !== null) {
          if (!parsed.visible.startsWith(summaryIdentityHeader(parsed.data)))
            addIssue(inspection, "case_identity", "Visible Markdown identity header differs from its machine block.");
          if (parsed.visible !== renderSummaryVisible(parsed.data))
            addIssue(inspection, "summary_provenance", "Visible summary filenames, references, content or coverage differ from its machine block.");
        }
      }
      else {
        inspection.rows = parseCsv(bytes.toString("utf8"));
        if (inspection.stored?.owned) {
          inspection.identity = inspection.stored.identity;
          inspection.language = inspection.stored.outputLanguage;
        }
      }
      if (inspection.stored?.owned && inspection.stored.hash !== inspection.hash)
        addIssue(inspection, "output_changed", "Registered output changed; regenerate with ownership/CAS checks or inspect as an ordinary file.");
    }
    catch {
      addIssue(inspection, "output_unreadable", "Output is missing, unsafe, oversized or structurally unreadable.");
    }
    return inspection;
  }
  private async resolveIdentity(workspace: WorkspaceInfo, item: OutputInspection, inspections: OutputInspection[], context: SourceContext | undefined, input: ValidateInput) {
    if (item.identity || !item.absolute)
      return;
    try {
      const file = await this.file(workspace, `${item.path}.lawoss.json`);
      const bytes = await readFile(file.absolute);
      const data = sidecarSchema.parse(JSON.parse(bytes.toString("utf8")));
      item.identity = data;
      item.language = data.outputLanguage;
      item.identityPath = file.path;
      item.identityHash = sha(bytes);
      if (!identityMatches(item, context, workspace, input.outputLanguage))
        addIssue(item, "identity_dependency", "Saved identity sidecar differs from the selected case/project/locale.");
      return;
    }
    catch (error) {
      if (!isMissing(error))
        addIssue(item, "identity_dependency", "Saved identity sidecar is unsafe or structurally invalid.");
    }
    const candidates = inspections.filter(candidate => candidate.summary !== undefined);
    const companion = candidates.find(candidate => candidate.issues.length === 0) ?? candidates[0];
    if (!companion)
      return;
    // Rejected identity is retained only for an unverified inspection record.
    // Its failures are explicit on the dependent output, regardless of path order.
    item.identity = companion.identity;
    item.language = companion.language;
    item.identityPath = companion.path;
    item.identityHash = companion.hash;
    if (companion.issues.length || !context)
      addIssue(item, "identity_dependency", `Identity companion ${companion.path} did not pass saved summary/provenance checks.`);
  }
  async validate(workspace: WorkspaceInfo, input: ValidateInput): Promise<ValidationResult> {
    return this.lock(async () => {
      input = validateInputSchema.parse(input);
      const issues: ValidationIssue[] = [];
      let context: SourceContext | undefined;
      try {
        context = await this.context(workspace, input.documentIds);
      }
      catch {
        issues.push({ code: "source_reference", message: "Selected source preparation/current hashes, or a present reference manifest identity/official URLs, are missing or mismatched." });
      }
      const inspections: OutputInspection[] = [];
      for (const path of input.paths)
        inspections.push(await this.inspect(workspace, path));
      // Validate every summary before using any of them as an identity dependency.
      for (const item of inspections.filter(item => item.summary !== undefined)) {
        validateIdentity(item, context, workspace, input.outputLanguage);
        validateRows(item, context);
        if (item.stored?.owned && item.stored.sourceHash !== context?.fingerprint)
          addIssue(item, "source_changed", "Registered source set or manifest changed; regenerate output.");
      }
      for (const item of inspections.filter(item => item.summary === undefined)) {
        await this.resolveIdentity(workspace, item, inspections, context, input);
        validateIdentity(item, context, workspace, input.outputLanguage);
        validateRows(item, context);
        if (item.stored?.owned && item.stored.sourceHash !== context?.fingerprint)
          addIssue(item, "source_changed", "Registered source set or manifest changed; regenerate output.");
      }
      // Finish freshness checks before assigning dependency verification.
      for (const item of inspections) {
        try {
          if (context && (await this.context(workspace, input.documentIds)).fingerprint !== context.fingerprint)
            addIssue(item, "source_changed", "Sources changed during validation.");
          if (item.absolute && sha(await readFile(item.absolute)) !== item.hash)
            addIssue(item, "output_changed", "Output changed during validation.");
          if (item.identityPath) {
            const file = await this.file(workspace, item.identityPath);
            if (sha(await readFile(file.absolute)) !== item.identityHash)
              addIssue(item, "identity_dependency", "Saved identity changed during validation.");
          }
        }
        catch {
          addIssue(item, "source_changed", "Output, identity dependency or sources changed during validation.");
        }
      }
      for (const item of inspections) {
        if (!item.identityPath)
          continue;
        const companion = inspections.find(candidate => candidate.path === item.identityPath);
        if (companion?.issues.length && !item.issues.some(issue => issue.code === "identity_dependency"))
          addIssue(item, "identity_dependency", `Identity companion ${companion.path} failed saved output checks.`);
      }
      const outputs: ValidationResult["outputs"] = [];
      for (const item of inspections) {
        const owned = item.stored?.owned ?? false;
        const verified = !!context && item.issues.length === 0;
        if (context && item.identity && item.hash) {
          await this.documents.saveOutputRecord(workspace, {
            sourceKind: context.sourceKind, path: item.path, hash: owned && item.stored ? item.stored.hash : item.hash, owned,
            identityPath: item.identityPath, identityHash: item.identityHash, documentIds: [...new Set(input.documentIds)], identity: item.identity,
            sourceHash: owned && item.stored ? item.stored.sourceHash : context.fingerprint, verifiedHash: verified ? item.hash : null,
            kind: item.stored?.kind ?? (item.summary ? "summary" : "registry"), outputLanguage: input.outputLanguage, verified: false, legalApproval: false,
          });
        }
        issues.push(...item.issues);
        outputs.push({ path: item.path, hash: item.hash, owned, verified });
      }
      return { valid: issues.length === 0, issues, outputs, legalApproval: false, instruction: issues.length ? "Repair the listed concrete issues; reread sources and revalidate saved files. Stop after three unsuccessful repairs and report remaining issues." : "Saved output and current source references passed formatting/provenance checks; legal review remains required." };
    });
  }
}
function coverage(record: DocumentEvidence, children: DocumentEvidence[]) {
  return { hash: record.hash, complete: record.complete, issue: record.issue ?? null, pages: record.pages, children: children.map(child => ({ hash: child.hash, provenance: child.provenance, complete: child.complete, issue: child.issue ?? null, pages: child.pages })) };
}
function isMissing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
type SourceContext = {
  manifest: {
    company: string | null;
    caseNumber: string | null;
    sourceUrl: string | null;
  };
  sourceKind: "isir" | "workspace";
  fingerprint: string;
  selected: Array<{
    record: DocumentEvidence;
    reference: z.infer<typeof manifestSchema>["documents"][number];
    children: DocumentEvidence[];
  }>;
};
type OutputInspection = {
  path: string;
  absolute: string | null;
  hash: string | null;
  stored: Awaited<ReturnType<LawossDocuments["outputRecord"]>>;
  rows: string[][];
  identity: OutputIdentity | undefined;
  language: z.infer<typeof outputLanguageSchema> | undefined;
  summary: SummaryData | undefined;
  identityPath: string | null;
  identityHash: string | null;
  issues: ValidationIssue[];
};
function addIssue(item: OutputInspection, code: string, message: string, row?: number) {
  item.issues.push({ code, path: item.path, message, ...(row === undefined ? {} : { row }) });
}
function identityMatches(item: OutputInspection, context: SourceContext | undefined, workspace: WorkspaceInfo, language: z.infer<typeof outputLanguageSchema>): boolean {
  return !!context && !!item.identity && item.identity.caseNumber === context.manifest.caseNumber && item.identity.company === context.manifest.company && item.identity.sourceUrl === context.manifest.sourceUrl && item.identity.project === workspace.name && item.language === language;
}
function validateIdentity(item: OutputInspection, context: SourceContext | undefined, workspace: WorkspaceInfo, language: z.infer<typeof outputLanguageSchema>) {
  if (!identityMatches(item, context, workspace, language))
    addIssue(item, "case_identity", "Missing or mismatched selected case, project or output language identity.");
  if (item.summary?.sourceKind && item.summary.sourceKind !== context?.sourceKind)
    addIssue(item, "case_identity", "Source reference kind differs from selected project/manifest mode.");
}
function validateRows(item: OutputInspection, context: SourceContext | undefined) {
  const [header, ...rows] = item.rows;
  if (!header || header.length !== 7 || header.some((value, index) => value !== CSV_HEADER[index] && !(index === 6 && value === "ctitelnost")))
    addIssue(item, "csv_header", "Expected canonical seven-field registry header (legacy ctitelnost accepted).");
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (row.length !== 7)
      addIssue(item, "csv_width", "Registry row must contain exactly seven fields.", index + 1);
    const source = context?.selected.find(source => source.reference.documentId === row[1]);
    if (!source)
      addIssue(item, "extra_source", "Registry includes an unselected source ID.", index + 1);
    else if (row[0] !== source.reference.file || row[2] !== source.reference.url)
      addIssue(item, "source_url", "Filename or document reference URL differs from selected source metadata.", index + 1);
    if (source) {
      try {
        const saved: unknown = JSON.parse(row[6]);
        if (!saved || typeof saved !== "object" || Array.isArray(saved))
          addIssue(item, "unsupported_coverage", "Extraction coverage cannot be verified; re-export with structured current source coverage.", index + 1);
        else if (!isDeepStrictEqual(saved, coverage(source.record, source.children)))
          addIssue(item, "coverage", "Structured extraction coverage, hashes, pages or attachment provenance differ from current preparation.", index + 1);
      }
      catch {
        addIssue(item, row[6]?.trimStart().startsWith("{") ? "coverage" : "unsupported_coverage", "Extraction coverage is malformed or unsupported; re-export with structured current source coverage.", index + 1);
      }
    }
    if (seen.has(row[1]))
      addIssue(item, "duplicate_source", "Registry source ID is duplicated.", index + 1);
    seen.add(row[1]);
  });
  for (const source of context?.selected ?? [])
    if (!seen.has(source.reference.documentId))
      addIssue(item, "missing_source", "Registry lacks a selected source.");
}
function savedSummaryMatches(path: string, text: string, identity: OutputIdentity, language: z.infer<typeof outputLanguageSchema>, sourceKind: "isir" | "workspace"): boolean {
  const parsed = parseSavedSummary(path, text);
  return isDeepStrictEqual(parsed.data.identity, identity)
    && parsed.data.outputLanguage === language
    && (!parsed.data.sourceKind || parsed.data.sourceKind === sourceKind)
    && (parsed.visible === null || parsed.visible === renderSummaryVisible(parsed.data));
}
