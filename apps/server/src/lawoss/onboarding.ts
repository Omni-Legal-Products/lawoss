import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { runtimeStorageDir, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import { registerLocalProject } from "../routes/workspaces.js";
import { addRoute, type RequestContext, type Route } from "../routes/registry.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { externalAppFilesRoot } from "./workspace-app-files.js";
import { executeOnboarding, inspectOnboardingRoot, previewOnboarding, recoverOnboardingOperation, type OnboardingPreview, type OnboardingResult } from "./onboarding-runtime.js";

/** OKF is opt-in; enabling it requires a dated acknowledgement of a versioned notice. */
const okfChoiceSchema = z.strictObject({
  enabled: z.boolean(), acknowledgedAt: z.iso.datetime().optional(), noticeVersion: z.string().trim().min(1).max(64).optional(),
}).superRefine((value, ctx) => {
  if (value.enabled && (!value.acknowledgedAt || !value.noticeVersion)) ctx.addIssue({ code: "custom", message: "Enabling OKF requires an acknowledged notice version." });
  if (!value.enabled && (value.acknowledgedAt || value.noticeVersion)) ctx.addIssue({ code: "custom", message: "A declined OKF choice stores no acknowledgement." });
});
const profileSchema = z.strictObject({
  version: z.literal(1), lawyerName: z.string().trim().min(1).max(200),
  jurisdiction: z.enum(["sk", "cz"]), language: z.enum(["sk", "cs", "en", "de"]),
  officeRoot: z.string().min(1).max(4096).optional(), clientRoot: z.string().min(1).max(4096).optional(),
  subjectRoot: z.string().min(1).max(4096).optional(),
  matterRoot: z.string().min(1).max(4096).optional(),
  trial: z.boolean().optional(),
  okf: okfChoiceSchema.optional(),
  step: z.enum(["identity", "okf", "office", "ai", "client", "matter", "done"]).optional(),
});
type Profile = z.infer<typeof profileSchema>;
const previewSchema = z.looseObject({
  action: z.enum(["office", "client", "subject", "matter", "existing"]),
  mode: z.enum(["new", "map", "trial_clone"]), appFiles: z.enum(["inside", "outside"]),
  root: z.string().min(1).optional(), target: z.string().min(1).optional(),
  clientRoot: z.string().min(1).optional(), officeMemoryRoot: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  plan: z.looseObject({ root: z.string().min(1), operations: z.array(z.looseObject({
    path: z.string().min(1), kind: z.enum(["file", "directory"]), content: z.string().optional(),
  })) }).optional(),
}).superRefine((value, ctx) => {
  if (value.mode === "new" && (!value.plan || !value.target || value.appFiles !== "inside")) ctx.addIssue({ code: "custom", message: "Invalid create preview." });
  if (value.mode === "map" && (!value.root || value.appFiles !== "outside" || typeof value.sourceDigest !== "string" || !value.externalProfile || typeof value.externalProfile !== "object")) ctx.addIssue({ code: "custom", message: "Invalid map preview." });
  if (value.mode === "trial_clone" && (!value.source || !value.target || value.appFiles !== "inside" || typeof value.sourceDigest !== "string" || value.trial !== true)) ctx.addIssue({ code: "custom", message: "Invalid trial preview." });
});
const ticketSchema = z.strictObject({ version: z.literal(1), id: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), preview: previewSchema, name: z.string(), officeMemoryRoot: z.string().min(1).optional() });
type Ticket = z.infer<typeof ticketSchema>;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const inside = (root: string, path: string) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`); };
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";

async function canonicalDirectory(path: string): Promise<string> {
  if (!isAbsolute(path) || await realpath(path) !== resolve(path) || !(await lstat(path)).isDirectory()) throw new ApiError(400, "invalid_path", "Choose an existing canonical directory.");
  return resolve(path);
}

async function readJson(path: string): Promise<unknown> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error("Invalid onboarding state file.");
    const bytes = Buffer.alloc(8 * 1024 * 1024 + 1);
    let size = 0;
    while (size < bytes.length) { const part = await file.read(bytes, size, bytes.length - size, null); if (!part.bytesRead) break; size += part.bytesRead; }
    if (size === bytes.length) throw new Error("Onboarding state is too large.");
    return JSON.parse(bytes.subarray(0, size).toString("utf8"));
  } finally { await file.close(); }
}

async function readTicket(path: string): Promise<Ticket> {
  const raw = await readJson(path);
  ticketSchema.parse(raw);
  return raw as Ticket;
}

async function writeJson(path: string, value: unknown, replace = false): Promise<void> {
  const target = replace ? `${path}.${randomUUID()}.tmp` : path;
  const file = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + "\n"); await file.sync(); } finally { await file.close(); }
  if (replace) { try { await rename(target, path); } catch (error) { await unlink(target); throw error; } }
}

/** Host-only durable previews. The client confirms an immutable ticket, never supplies operations. */
export function registerOnboardingRoutes(options: {
  routes: Route[]; config: ServerConfig;
  jsonResponse: (data: unknown, status?: number) => Response;
  readJsonBodyLimited: (request: Request, maxBytes: number) => Promise<Record<string, unknown>>;
  ensureWritable: (config: ServerConfig) => void;
  onWorkspacesChanged: () => void;
  serializeWorkspace: (workspace: WorkspaceInfo) => unknown;
}): void {
  const { config } = options;
  const storage = join(runtimeStorageDir(config), "lawoss-onboarding");
  const profilePath = join(storage, "profile.json");
  const busy = new Set<string>();
  let profileQueue: Promise<unknown> = Promise.resolve();
  const ensureStorage = async () => { await mkdir(storage, { recursive: true, mode: 0o700 }); await canonicalDirectory(storage); };
  const readProfile = async (): Promise<Profile | null> => { try { return profileSchema.parse(await readJson(profilePath)); } catch (error) { if (missing(error)) return null; throw error; } };
  const body = (ctx: RequestContext) => options.readJsonBodyLimited(ctx.request, 64 * 1024);
  const route = (method: string, path: string, handler: (ctx: RequestContext) => Promise<unknown>) => addRoute(options.routes, method, `/lawoss/onboarding/${path}`, "host", async ctx => {
    if (method !== "GET") options.ensureWritable(config);
    try { return options.jsonResponse(await handler(ctx)); }
    catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, "onboarding_failed", error instanceof Error ? error.message : "Onboarding failed.");
    }
  });
  route("GET", "status", async () => ({ profile: await readProfile(), capabilities: { map: true, trialClone: true } }));
  route("POST", "profile", async ctx => {
    const rawPatch = profileSchema.partial().extend({ subjectRoot: z.string().min(1).max(4096).nullable().optional() }).parse(await body(ctx));
    const patch = { ...rawPatch, ...(rawPatch.subjectRoot === null ? { subjectRoot: undefined, matterRoot: undefined } : {}) };
    const change = async () => {
      const previous = await readProfile();
      const changesClient = patch.clientRoot !== undefined && patch.clientRoot !== previous?.clientRoot;
      const profile = profileSchema.parse({ ...previous, ...(changesClient ? { subjectRoot: undefined, matterRoot: undefined, trial: false } : {}), ...patch, version: 1 });
      for (const [key, level] of [["officeRoot", "office"], ["clientRoot", "client"], ["subjectRoot", "subject"], ["matterRoot", "matter"]] as const) {
        const path = profile[key]; if (!path) continue;
        await canonicalDirectory(path);
        const inspection = await inspectOnboardingRoot(path);
        const mappedClient = key === "clientRoot" && config.workspaces.some(workspace => workspace.path === path && workspace.appFiles === "outside");
        if (!mappedClient && (!inspection.complete || inspection.level !== level)) throw new ApiError(400, "invalid_scope", `Selected ${key} does not identify a complete ${level}.`);
      }
      if (profile.matterRoot && (!profile.clientRoot || !inside(profile.clientRoot, profile.matterRoot))) throw new ApiError(400, "invalid_scope", "Matter must be within the selected client.");
      if (profile.subjectRoot && (!profile.clientRoot || !inside(profile.clientRoot, profile.subjectRoot))) throw new ApiError(400, "invalid_scope", "Subject must be within the selected client.");
      if (profile.clientRoot) {
        try { const marker = z.object({ version: z.literal(1), trial: z.literal(true) }).parse(await readJson(join(profile.clientRoot, ".lawoss-trial.json"))); profile.trial = marker.trial; }
        catch (error) { if (!missing(error)) throw error; profile.trial = false; }
      }
      await ensureStorage(); await writeJson(profilePath, profile, true); return profile;
    };
    const pending = profileQueue.then(change); profileQueue = pending.catch(() => undefined); return pending;
  });
  route("POST", "classify", async ctx => {
    const input = z.strictObject({ root: z.string().min(1).max(4096) }).parse(await body(ctx));
    const inspection = await inspectOnboardingRoot(input.root);
    return { ...inspection, memoryCandidates: inspection.memorySources };
  });
  route("POST", "plan", async ctx => {
    const input = await body(ctx), preview = await previewOnboarding(input);
    // The state/journal must never live inside an inspected client or parent.
    const original = preview.mode === "map" ? preview.root : preview.mode === "trial_clone" ? preview.source : preview.plan?.root;
    if (!original || inside(original, storage)) throw new ApiError(400, "invalid_storage", "Application state must be outside the selected source directory.");
    await ensureStorage();
    const id = randomUUID();
    const name = typeof input.title === "string" ? input.title : basename(preview.target ?? preview.root ?? original);
    let officeMemoryRoot: string | undefined;
    const profile = await readProfile();
    if (profile?.officeRoot && (preview.action === "client" || preview.action === "existing")) {
      for (const candidate of [profile.officeRoot, join(profile.officeRoot, "Office"), join(profile.officeRoot, "_kancelaria")]) {
        try {
          if (!["Office", "_kancelaria"].includes(basename(candidate))) continue;
          await canonicalDirectory(candidate);
          if ((await inspectOnboardingRoot(candidate)).level === "office") { officeMemoryRoot = candidate; break; }
        } catch { /* Only a validated office folder can be proposed as an explicit grant. */ }
      }
    }
    const confirmedPreview = { ...preview, ...(officeMemoryRoot ? { officeMemoryRoot } : {}) };
    const fingerprint = digest(confirmedPreview);
    const ticket: Ticket = { version: 1, id, fingerprint, preview: confirmedPreview, name, ...(officeMemoryRoot ? { officeMemoryRoot } : {}) };
    await writeJson(join(storage, `${id}.json`), ticket);
    return { id, fingerprint, preview: { ...preview, operations: preview.plan?.operations.map(operation => operation.path) ?? [], warnings: preview.mode === "trial_clone" ? ["trial_clone"] : [], label: preview.target ?? preview.root, officeMemoryRoot } };
  });
  route("POST", "apply", async ctx => {
    const input = z.strictObject({ id: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal(true) }).parse(await body(ctx));
    if (busy.has(input.id)) throw new ApiError(409, "onboarding_busy", "This onboarding operation is already running.");
    busy.add(input.id);
    try {
      const ticket = await readTicket(join(storage, `${input.id}.json`));
      if (ticket.version !== 1 || ticket.id !== input.id || ticket.fingerprint !== input.fingerprint || digest(ticket.preview) !== input.fingerprint || ticket.officeMemoryRoot !== ticket.preview.officeMemoryRoot) throw new ApiError(409, "stale_preview", "Preview fingerprint does not match. Create a new preview.");
      const receiptPath = join(storage, `${input.id}.result.json`);
      let result: OnboardingResult;
      let repeated = false;
      try { const receipt = z.object({ fingerprint: z.literal(input.fingerprint), result: z.object({ root: z.string(), clientRoot: z.string().optional(), matterRoot: z.string().optional(), appFiles: z.enum(["inside", "outside"]), trial: z.literal(true).optional(), status: z.enum(["applied", "already_applied", "rolled_back"]).optional() }) }).parse(await readJson(receiptPath)); result = receipt.result; repeated = true; }
      catch (error) {
        if (!missing(error)) throw error;
        const workspaceRoot = ticket.preview.root ?? ticket.preview.target;
        if (!workspaceRoot) throw new Error("Onboarding preview has no target.");
        const externalProfileDirectory = join(externalAppFilesRoot(config, { path: workspaceRoot }), ".opencode");
        const journalDirectory = join(storage, "journal");
        await mkdir(journalDirectory, { recursive: true, mode: 0o700 });
        await mkdir(externalProfileDirectory, { recursive: true, mode: 0o700 });
        result = await executeOnboarding(ticket.preview, { journalDirectory, externalProfileDirectory });
        await writeJson(receiptPath, { fingerprint: input.fingerprint, result });
      }
      if (result.status === "rolled_back") throw new ApiError(409, "onboarding_rolled_back", "This plan was rolled back. Create a new preview.");
      if (ticket.preview.action === "office") return { result: repeated ? "already_applied" : "applied", ...result };
      const clientRoot = result.clientRoot ?? (ticket.preview.action === "existing" || ticket.preview.action === "client" ? result.root : undefined);
      if (!clientRoot) throw new Error("Onboarding did not return a client workspace.");
      await canonicalDirectory(clientRoot);
      const prior = config.workspaces.find(workspace => workspace.path === clientRoot);
      const appFiles = ticket.preview.action === "matter" || ticket.preview.action === "subject" ? prior?.appFiles ?? result.appFiles : result.appFiles;
      const { workspace } = await registerLocalProject(config, { folderPath: clientRoot, name: prior?.name ?? ticket.name, preset: "starter", registerExisting: true, appFiles });
      if (ticket.officeMemoryRoot && !(await lstat(join(storage, `${input.id}.office-grant.json`)).then(() => true).catch(error => { if (missing(error)) return false; throw error; }))) {
        const office = await canonicalDirectory(ticket.officeMemoryRoot);
        await writeRuntimeOpencodeConfig(config, workspace.id, current => {
          const permission = current.permission && typeof current.permission === "object" && !Array.isArray(current.permission) ? current.permission : {};
          const grants = permission.external_directory && typeof permission.external_directory === "object" && !Array.isArray(permission.external_directory) ? permission.external_directory : {};
          return { ...current, permission: { ...permission, external_directory: { ...grants, [`${office}/*`]: "allow" } } };
        });
        await writeJson(join(storage, `${input.id}.office-grant.json`), { fingerprint: input.fingerprint, office });
      }
      options.onWorkspacesChanged();
      const currentProfile = result.matterRoot ? await readProfile() : null;
      const subjectRoot = currentProfile?.subjectRoot && result.matterRoot && inside(clientRoot, currentProfile.subjectRoot) && inside(currentProfile.subjectRoot, result.matterRoot) ? currentProfile.subjectRoot : null;
      return { ...(result.matterRoot ? { subjectRoot } : {}), result: repeated || result.status === "already_applied" ? "already_applied" : "applied", ...result, appFiles, workspace: options.serializeWorkspace(workspace), activeId: workspace.id, workspaces: config.workspaces.map(options.serializeWorkspace) };
    } finally { busy.delete(input.id); }
  });
  route("POST", "recover", async ctx => {
    const input = z.strictObject({ id: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal(true), action: z.enum(["finish", "rollback"]) }).parse(await body(ctx));
    if (busy.has(input.id)) throw new ApiError(409, "onboarding_busy", "This onboarding operation is already running.");
    busy.add(input.id);
    try {
      const ticket = await readTicket(join(storage, `${input.id}.json`));
      if (ticket.version !== 1 || ticket.id !== input.id || ticket.fingerprint !== input.fingerprint || digest(ticket.preview) !== input.fingerprint) throw new ApiError(409, "stale_preview", "Preview fingerprint does not match.");
      // Registered workspaces may have active sessions and later edits. Recovery is for interrupted apply only.
      try { await readJson(join(storage, `${input.id}.result.json`)); throw new ApiError(409, "onboarding_completed", "Completed onboarding cannot be rolled back through interrupted-operation recovery."); }
      catch (error) { if (!missing(error)) throw error; }
      const target = ticket.preview.root ?? ticket.preview.target;
      if (!target) throw new Error("Onboarding preview has no target.");
      const result = await recoverOnboardingOperation(ticket.preview, { journalDirectory: join(storage, "journal"), externalProfileDirectory: join(externalAppFilesRoot(config, { path: target }), ".opencode") }, input.action);
      // A finished transaction is subsequently registered by the ordinary idempotent apply path.
      return result;
    } finally { busy.delete(input.id); }
  });
}
