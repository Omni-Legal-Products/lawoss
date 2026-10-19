import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { relative } from "node:path";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import { DocumentExports, exportInputSchema, validateInputSchema } from "../documents/export.js";
import { isSensitiveWorkspacePath, resolveWorkspaceFilePath } from "../filesystem-boundary.js";
import { realpath } from "../canonical-path.js";
import { isPathWithin } from "../path-within.js";
import type { LawossDocuments } from "../documents/service.js";
import type { WorkspaceInfo } from "../../types.js";

const sourcesSchema = z.array(z.strictObject({ id: z.string().uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(500);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const listSchema = z.strictObject({ offset: z.number().int().min(0).max(500).default(0), limit: z.number().int().min(1).max(50).default(50) });
const readSchema = z.strictObject({ id: z.string().uuid(), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(16000).default(16000) });
function protectedMetadataPath(path: string): boolean {
  const segments = path.replaceAll("\\", "/").split("/").map(segment => segment.toLowerCase().replace(/:.*$/, "").replace(/[. ]+$/, ""));
  return isSensitiveWorkspacePath(path) || segments.some(segment => segment.startsWith(".") || ["agents.md", "claude.md"].includes(segment));
}

async function selectedRoot(workspaceRoot: string, directory: string) {
  const path = await realpath(workspaceRoot), info = await stat(path);
  let scope: string;
  try {scope = await resolveWorkspaceFilePath(workspaceRoot, directory, {allowRoot: true});}
  catch {throw new ApiError(403, "protected_directory_denied", "The selected case must remain inside this project.");}
  const scopeInfo = await stat(scope);
  if (!info.isDirectory() || !scopeInfo.isDirectory()) throw new ApiError(403, "protected_directory_denied", "Select an existing case directory.");
  return {path, scope, identity: [path, info.dev, info.ino, scope, scopeInfo.dev, scopeInfo.ino]};
}

/** A guest capability owns selected prepared IDs, never a general workspace token. */
export class ProtectedDocumentTools {
  private readonly exports: DocumentExports;
  private readonly outputs = new Map<string, string>();
  private constructor(private readonly documents: LawossDocuments, private readonly workspace: WorkspaceInfo,
    private readonly sources: Array<{ id: string; hash: string }>, private readonly rootIdentity: string,
    private readonly rootReference: string, private readonly directoryReference: string, private readonly directory: string) {
    this.exports = new DocumentExports(documents);
  }

  static async open(input: { documents: LawossDocuments; workspace: WorkspaceInfo; sources: Array<{ id: string; hash: string }>; directory?: string }): Promise<ProtectedDocumentTools> {
    const sources = sourcesSchema.parse(input.sources);
    if (new Set(sources.map(source => source.id)).size !== sources.length)
      throw new ApiError(400, "protected_source_selection", "Select each prepared source once.");
    const directory = input.directory ?? input.workspace.path;
    const selected = await selectedRoot(input.workspace.path, directory);
    const tools = new ProtectedDocumentTools(input.documents, { ...input.workspace, path: selected.path }, sources,
      digest([input.workspace.id, ...selected.identity]), input.workspace.path, directory, selected.scope);
    await tools.currentBinding();
    return tools;
  }

  async currentBinding(): Promise<{ sourceSetSha256: string; rootIdentity: string }> {
    const root = await selectedRoot(this.rootReference, this.directoryReference);
    if (digest([this.workspace.id, ...root.identity]) !== this.rootIdentity)
      throw new ApiError(409, "protected_source_stale", "The selected project or case directory changed.");
    const evidence = [];
    for (const source of this.sources) {
      const current = await this.documents.evidence(this.workspace, source.id);
      if (current.hash !== source.hash || current.workspaceId !== this.workspace.id)
        throw new ApiError(409, "protected_source_stale", "The selected prepared evidence changed.");
      const physical = await resolveWorkspaceFilePath(this.workspace.path, current.provenance.sourcePath);
      if (!isPathWithin(this.directory, physical) || protectedMetadataPath(current.provenance.sourcePath)
        || protectedMetadataPath(relative(this.workspace.path, physical))
        || (current.provenance.attachmentName !== undefined && protectedMetadataPath(current.provenance.attachmentName)))
        throw new ApiError(403, "protected_source_denied", "Select case evidence without credentials or application instructions.");
      evidence.push(current);
    }
    const selected = new Set(this.sources.map(source => source.id));
    const all = await this.documents.list(this.workspace);
    if (evidence.some(record => record.provenance.parentId && !selected.has(record.provenance.parentId))
      || all.some(record => record.provenance.parentId && selected.has(record.provenance.parentId) && !selected.has(record.id)))
      throw new ApiError(409, "protected_source_selection", "Select the original sources and their complete prepared attachment tree.");
    return { sourceSetSha256: digest(evidence.sort((a, b) => a.id.localeCompare(b.id))), rootIdentity: this.rootIdentity };
  }

  async invoke(name: string, arguments_: unknown, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    if (!["lawoss_documents_list", "lawoss_documents_read", "lawoss_documents_export", "lawoss_documents_validate"].includes(name))
      throw new ApiError(403, "protected_tool_denied", "This operation is not a protected document capability.");
    await this.currentBinding();
    signal.throwIfAborted();
    if (name === "lawoss_documents_export" || name === "lawoss_documents_validate") {
      const originals = (await this.documents.list(this.workspace)).filter(record => this.sources.some(source => source.id === record.id) && !record.provenance.parentId).map(record => record.id);
      const input = name === "lawoss_documents_export" ? exportInputSchema.parse(arguments_) : validateInputSchema.parse(arguments_);
      if (input.documentIds.length !== originals.length || new Set(input.documentIds).size !== originals.length || input.documentIds.some(id => !originals.includes(id)))
        throw new ApiError(403, "protected_source_denied", "Outputs must use exactly the selected original sources.");
      if ("path" in input) {
        const path = input.path.replaceAll("\\", "/");
        if (path.split("/").some(part => !part || part === ".." || part.startsWith(".") || /^(AGENTS|CLAUDE)\.md$/i.test(part)) || isSensitiveWorkspacePath(path))
          throw new ApiError(403, "protected_output_denied", "A protected run cannot change application configuration.");
        await this.requireOutputPath(path);
        if (input.expectedHash && this.outputs.get(path) !== input.expectedHash)
          throw new ApiError(403, "protected_output_denied", "A protected run can repair only its own freshly created output.");
        const result = await this.exports.export(this.workspace, input);
        this.outputs.set(result.path, result.hash);
        return result;
      }
      if (input.paths.some(path => !this.outputs.has(path)))
        throw new ApiError(403, "protected_output_denied", "Only outputs created by this operation can be validated.");
      for (const path of input.paths) await this.requireOutputPath(path);
      return this.exports.validate(this.workspace, input);
    }
    if (name === "lawoss_documents_read") {
      const input = readSchema.parse(arguments_);
      if (!this.sources.some(source => source.id === input.id))
        throw new ApiError(403, "protected_source_denied", "This source was not selected for the operation.");
      const content = await this.documents.read(this.workspace, input.id, input.offset, input.limit);
      await this.currentBinding();
      signal.throwIfAborted();
      return content;
    }
    const input = listSchema.parse(arguments_);
    const selected = new Set(this.sources.map(source => source.id));
    const records = (await this.documents.list(this.workspace)).filter(record => selected.has(record.id));
    const end = Math.min(records.length, input.offset + input.limit);
    return { documents: records.slice(input.offset, end), nextOffset: end < records.length ? end : null, untrusted: true };
  }

  private async requireOutputPath(path: string): Promise<void> {
    let physical: string;
    try {physical = await resolveWorkspaceFilePath(this.workspace.path, path);}
    catch {throw new ApiError(403, "protected_output_denied", "Outputs must remain inside the selected case.");}
    if (!isPathWithin(this.directory, physical) || protectedMetadataPath(relative(this.workspace.path, physical)))
      throw new ApiError(403, "protected_output_denied", "Outputs must remain inside the selected case without changing application configuration.");
  }
}
