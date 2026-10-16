import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { WikiSuggestion, WikiSuggestionInput } from "@legalwork/types/wiki-suggestions";
import { WikiSuggestionSchema, wikiSuggestionFile } from "./suggestion-schema.js";
import { ApiError } from "../errors.js";

const Metadata = WikiSuggestionSchema.omit({ content: true, revision: true, filePath: true });
const locks = new Map<string, Promise<unknown>>();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";

/** Drafts belong to the originating project. Nothing here writes a wiki. */
export class WikiSuggestions {
  constructor(private root: string, private workspaceId: string) {}

  async locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    const key = `${await realpath(this.root)}:${id}`;
    const next = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
    locks.set(key, next);
    try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
  }

  private async path(parts: string[], create = false) {
    let path = await realpath(this.root);
    for (const [index, part] of [".legalwork", "tmp", "wiki-suggestions", ...parts].entries()) {
      path = join(path, part);
      const last = index === parts.length + 2;
      if (create && !last) await mkdir(path).catch(error => { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; });
      const stat = await lstat(path).catch(error => { if (missing(error) && (create || last)) return null; throw error; });
      if (stat?.isSymbolicLink() || (stat && !last && !stat.isDirectory())) throw new ApiError(400, "invalid_suggestion_path", "The suggestion folder must be inside this project, without symbolic links.");
    }
    return path;
  }
  private id(id: string) {
    if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "invalid_suggestion", "Choose a wiki suggestion.");
    return id;
  }
  private async put(id: string, file: string, content: string) {
    if (Buffer.byteLength(content) > (file === "draft.md" ? 2_000_000 : 128_000)) throw new ApiError(413, "suggestion_too_large", "This draft is too large.");
    const path = await this.path([this.id(id), file], true);
    const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
      await this.path([id, file]);
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
  }
  async read(id: string): Promise<WikiSuggestion> {
    try {
      const metadataPath = await this.path([this.id(id), "suggestion.json"]);
      if ((await lstat(metadataPath)).size > 128_000) throw new ApiError(413, "suggestion_too_large", "This draft is too large.");
      const meta = Metadata.parse(JSON.parse(await readFile(metadataPath, "utf8")));
      const path = await this.path([id, "draft.md"]);
      if ((await lstat(path)).size > 2_000_000) throw new ApiError(413, "suggestion_too_large", "This draft is too large.");
      const content = await readFile(path, "utf8");
      return { ...meta, id, workspaceId: this.workspaceId, content, revision: hash(JSON.stringify(meta) + content), filePath: wikiSuggestionFile(id) };
    } catch (error) {
      if (missing(error)) throw new ApiError(404, "suggestion_not_found", "This suggestion is no longer available.");
      throw error;
    }
  }
  async list() {
    const folder = await this.path(["."]).catch(error => { if (missing(error)) return null; throw error; });
    if (!folder) return [];
    const entries = await readdir(folder, { withFileTypes: true }).catch(error => { if (missing(error)) return []; throw error; });
    const result: WikiSuggestion[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !z.string().uuid().safeParse(entry.name).success) continue;
      result.push(await this.read(entry.name));
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }
  async create(input: WikiSuggestionInput, sessionId: string | null) {
    const id = randomUUID(), now = Date.now();
    await this.put(id, "draft.md", input.content);
    await this.put(id, "suggestion.json", JSON.stringify({ ...input, content: undefined, id, workspaceId: this.workspaceId, sessionId, status: "pending", createdAt: now, updatedAt: now }));
    return this.read(id);
  }
  async current(id: string, revision: string) {
    const current = await this.read(id);
    if (current.status !== "pending") throw new ApiError(409, "suggestion_closed", "This suggestion has already been saved or dismissed.");
    if (current.revision !== revision) throw new ApiError(409, "suggestion_changed", "This draft changed. Reload it before continuing; your text is still available in the editor.");
    return current;
  }
  async update(id: string, revision: string, input: WikiSuggestionInput) {
    return this.locked(id, async () => {
      const current = await this.current(id, revision);
      await this.put(id, "draft.md", input.content);
      await this.put(id, "suggestion.json", JSON.stringify(Metadata.parse({ ...current, ...input, updatedAt: Date.now() })));
      return this.read(id);
    });
  }
  /** Caller holds the lock while publishing or dismissing. */
  async finish(current: WikiSuggestion, status: "saved" | "dismissed") {
    await this.put(current.id, "suggestion.json", JSON.stringify(Metadata.parse({ ...current, status, updatedAt: Date.now() })));
    return this.read(current.id);
  }
}
