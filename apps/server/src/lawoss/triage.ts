import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { addRoute, type RequestContext, type Route } from "../routes/registry.js";
import type { ServerConfig } from "../types.js";
import { applyTriagePlan, listTriageRuns, parseClassification, prepareTriage, replanTriage, undoTriage, verifyTrialClone, type TriageClassification, type TriageInventory, type TriagePlan } from "./onboarding-runtime.js";

/**
 * Roztriedenie dokumentov v skúšobnom klone (host-only). Klient potvrdzuje uložený náhľad podľa
 * jeho odtlačku; operácie nikdy neposiela. Každý zápis overí klon aj záznamom appky o jeho vytvorení.
 */
type Ticket = { version: 1; id: string; root: string; inventory: TriageInventory; classification?: TriageClassification; keepInInbox: string[]; plan: TriagePlan };
const rootSchema = z.string().min(1).max(4096).refine(isAbsolute, "Absolute path required.");
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";

async function writeNew(path: string, value: unknown): Promise<void> {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
}

/** Náhľad pre advokáta: kam čo pôjde a prečo. Obsah nových kariet zostáva na serveri. */
function view(ticket: Ticket, proposal?: unknown) {
  const { plan, inventory } = ticket;
  return {
    id: ticket.id, fingerprint: plan.fingerprint, runId: plan.runId, root: plan.root, language: plan.language,
    documents: inventory.documents.length, keepInInbox: ticket.keepInInbox, classification: plan.classification,
    matters: plan.matters, moves: plan.moves.map(({ sha256: _sha, ...move }) => move), stays: plan.stays,
    newFolders: plan.create.filter(operation => operation.kind === "directory").length,
    ...(proposal ? { proposal } : {}),
  };
}

export function registerTriageRoutes(options: {
  routes: Route[]; config: ServerConfig; storage: string;
  jsonResponse: (data: unknown, status?: number) => Response;
  readJsonBodyLimited: (request: Request, maxBytes: number) => Promise<Record<string, unknown>>;
  ensureWritable: (config: ServerConfig) => void;
  jurisdiction: () => Promise<"sk" | "cz" | undefined>;
}): void {
  const { config } = options;
  const tickets = join(options.storage, "triage");
  const trialJournalDirectory = join(options.storage, "journal");
  const busy = new Set<string>();
  const body = (ctx: RequestContext) => options.readJsonBodyLimited(ctx.request, 256 * 1024);
  const ensureTickets = async () => {
    await mkdir(tickets, { recursive: true, mode: 0o700 });
    if (await realpath(tickets) !== resolve(tickets) || !(await lstat(tickets)).isDirectory()) throw new Error("Unsafe triage storage.");
  };
  const readTicket = async (id: string): Promise<Ticket> => {
    let raw: unknown;
    try { raw = JSON.parse(await readFile(join(tickets, `${id}.json`), "utf8")); }
    catch (error) { if (missing(error)) throw new ApiError(404, "triage_not_found", "Preview not found. Create a new preview."); throw error; }
    const ticket = z.looseObject({ version: z.literal(1), id: z.string(), root: z.string(), inventory: z.looseObject({}), keepInInbox: z.array(z.string()), plan: z.looseObject({ fingerprint: z.string() }) }).parse(raw);
    if (ticket.id !== id) throw new ApiError(409, "stale_preview", "Preview does not match.");
    // Uložil ho tento server; plán sa pred zápisom aj tak overí celý vrátane odtlačku.
    return raw as Ticket;
  };
  const store = async (root: string, inventory: TriageInventory, classification: TriageClassification | undefined, keepInInbox: string[], plan: TriagePlan): Promise<Ticket> => {
    await ensureTickets();
    const ticket: Ticket = { version: 1, id: randomUUID(), root, inventory, ...(classification ? { classification } : {}), keepInInbox, plan };
    await writeNew(join(tickets, `${ticket.id}.json`), ticket);
    return ticket;
  };
  const route = (path: string, handler: (ctx: RequestContext) => Promise<unknown>) => addRoute(options.routes, "POST", `/lawoss/triage/${path}`, "host", async ctx => {
    try { return options.jsonResponse(await handler(ctx)); }
    catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof z.ZodError) throw new ApiError(400, "invalid_request", "Invalid triage request.");
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "";
      throw new ApiError(code === "not_trial_clone" ? 403 : code === "triage_conflict" ? 409 : 400, code || "triage_failed", error instanceof Error ? error.message : "Triage failed.");
    }
  });

  route("status", async ctx => {
    const { root } = z.strictObject({ root: rootSchema }).parse(await body(ctx));
    try {
      const clone = await verifyTrialClone(root, trialJournalDirectory);
      return { trial: true, root: clone.root, runs: await listTriageRuns(clone.root) };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "not_trial_clone") return { trial: false, reason: error instanceof Error ? error.message : "" , runs: [] };
      throw error;
    }
  });
  route("plan", async ctx => {
    options.ensureWritable(config);
    const input = z.strictObject({ root: rootSchema, useModel: z.boolean().optional() }).parse(await body(ctx));
    const { inventory, plan, proposal, classification } = await prepareTriage(input.root, { trialJournalDirectory, useModelProposal: input.useModel === true, jurisdiction: await options.jurisdiction() });
    if (input.useModel === true && !classification) throw new ApiError(409, "triage_no_model_proposal", "No current model proposal for this folder.");
    return view(await store(inventory.root, inventory, classification, [], plan), proposal);
  });
  route("replan", async ctx => {
    options.ensureWritable(config);
    const input = z.strictObject({ id: z.uuid(), keepInInbox: z.array(z.string().regex(/^d[a-f0-9]{16}$/)).max(5000) }).parse(await body(ctx));
    const previous = await readTicket(input.id);
    const known = new Set(previous.inventory.documents.map(document => document.id));
    const keep = [...new Set(input.keepInInbox)].filter(id => known.has(id));
    const classification = previous.classification ? parseClassification(previous.classification, previous.inventory) : undefined;
    const plan = replanTriage(previous.inventory, classification, keep);
    return view(await store(previous.root, previous.inventory, classification, keep, plan));
  });
  route("apply", async ctx => {
    options.ensureWritable(config);
    const input = z.strictObject({ id: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal(true) }).parse(await body(ctx));
    if (busy.size) throw new ApiError(409, "triage_busy", "Another triage operation is running.");
    busy.add(input.id);
    try {
      const ticket = await readTicket(input.id);
      if (ticket.plan.fingerprint !== input.fingerprint) throw new ApiError(409, "stale_preview", "Preview fingerprint does not match. Create a new preview.");
      return await applyTriagePlan(ticket.plan, { trialJournalDirectory });
    } finally { busy.delete(input.id); }
  });
  route("undo", async ctx => {
    options.ensureWritable(config);
    const input = z.strictObject({ root: rootSchema, runId: z.string().regex(/^triage-\d{8}-\d{6}-[a-f0-9]{6}$/), confirm: z.literal(true) }).parse(await body(ctx));
    if (busy.size) throw new ApiError(409, "triage_busy", "Another triage operation is running.");
    busy.add(input.runId);
    try { return await undoTriage(input.root, input.runId, { trialJournalDirectory }); }
    finally { busy.delete(input.runId); }
  });
}
