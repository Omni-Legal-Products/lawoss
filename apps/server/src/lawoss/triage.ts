import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { realpath } from "./canonical-path.js";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { addRoute, type RequestContext, type Route } from "../routes/registry.js";
import type { ServerConfig } from "../types.js";
import { applyTriagePlan, grantInPlaceReorganize, listTriageRuns, parseClassification, prepareTriage, replanTriage, undoTriage, verifyTriageTarget, type TriageClassification, type TriageInventory, type TriagePlan, type TriageTargetOptions } from "./onboarding-runtime.js";

/**
 * Roztriedenie dokumentov v skúšobnom klone (host-only). Klient potvrdzuje uložený náhľad podľa
 * jeho odtlačku; operácie nikdy neposiela. Každý zápis overí klon aj záznamom appky o jeho vytvorení.
 */
/** `leaveInPlace`: existujúce priečinky, ktoré advokát v náhľade odškrtol (ostanú nedotknuté). */
type Ticket = { version: 1; id: string; root: string; inventory: TriageInventory; classification?: TriageClassification; keepInInbox: string[]; leaveInPlace?: string[]; plan: TriagePlan };
const rootSchema = z.string().min(1).max(4096).refine(isAbsolute, "Absolute path required.");
const LEAVE_SCHEMA = z.array(z.string().regex(/^existing-[a-f0-9]{12}$/)).max(5000);
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";
const UNAVAILABLE_ROOT = new Set(["ENOTDIR", "EACCES", "ENOENT"]);

async function writeNew(path: string, value: unknown): Promise<void> {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
}

/** Náhľad pre advokáta: kam čo pôjde a prečo. Obsah nových kariet zostáva na serveri. */
function view(ticket: Ticket, proposal?: unknown) {
  const { plan, inventory } = ticket;
  return {
    id: ticket.id, fingerprint: plan.fingerprint, runId: plan.runId, root: plan.root, language: plan.language,
    documents: inventory.documents.length, keepInInbox: ticket.keepInInbox, leaveInPlace: ticket.leaveInPlace ?? [], classification: plan.classification,
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
  // Súhlas s usporiadaním na mieste eviduje hostiteľ, nie priečinok klienta: značku `.lawoss/reorganize.json`
  // vie zapísať ktokoľvek (aj agent). Záznam zapisuje len `grant`; jadro presúva v origináli len s `allowInPlace`.
  const consents = join(options.storage, "consent");
  const consentPath = (root: string) => join(consents, `${createHash("sha256").update(root).digest("hex")}.json`);
  // Súhlas platí na jedno usporiadanie (rozhodnutie MČ 12. 10., spec lawOSS-like-SK-CZ#92): po zápise nesie `runId`
  // a dovolí už len vrátenie tohto behu, po vrátení zanikne. Ďalšie usporiadanie potrebuje nový `grant`.
  const RUN_ID = /^triage-\d{8}-\d{6}-[a-f0-9]{6}$/;
  const consentSchema = z.strictObject({ version: z.literal(1), workspaceId: z.string().min(1), root: z.string().min(1), grantedAt: z.string().min(1), runId: z.string().regex(RUN_ID).optional() });
  type Consent = z.infer<typeof consentSchema>;
  const registeredClient = (root: string) => config.workspaces.find(workspace => workspace.workspaceType !== "remote" && resolve(workspace.path) === root && (workspace.appFiles ?? "inside") === "inside");
  /** Záznam z `grant` pre priečinok, ktorý je stále pripojený ako klient so súbormi appky vnútri; inak nič. */
  const readConsent = async (rootInput: string): Promise<Consent | undefined> => {
    if (!isAbsolute(rootInput)) return undefined;
    const root = resolve(rootInput), workspace = registeredClient(root);
    if (!workspace) return undefined;
    let raw: unknown;
    try { raw = JSON.parse(await readFile(consentPath(root), "utf8")); }
    catch (error) { if (missing(error) || error instanceof SyntaxError) return undefined; throw error; }
    const consent = consentSchema.safeParse(raw);
    return consent.success && consent.data.root === root && consent.data.workspaceId === workspace.id ? consent.data : undefined;
  };
  /** `allowInPlace` pre nový náhľad a zápis (nespotrebovaný súhlas) alebo pre vrátenie behu, na ktorý sa súhlas spotreboval. */
  const hostConsent = async (rootInput: string, use: { plan: true } | { undo: string } | { status: true }): Promise<TriageTargetOptions> => {
    const consent = await readConsent(rootInput);
    if (!consent) return {};
    if ("plan" in use) return { allowInPlace: consent.runId === undefined };
    if ("undo" in use) return { allowInPlace: consent.runId === use.undo };
    return { allowInPlace: true };
  };
  const ensureConsents = async () => {
    await mkdir(consents, { recursive: true, mode: 0o700 });
    if (await realpath(consents) !== resolve(consents) || !(await lstat(consents)).isDirectory()) throw new Error("Unsafe consent storage.");
  };
  const writeConsent = async (consent: Consent) => {
    await ensureConsents();
    const temporary = join(consents, `${randomUUID()}.tmp`);
    try { await writeNew(temporary, consent); await rename(temporary, consentPath(consent.root)); }
    catch (error) { await rm(temporary, { force: true }); throw error; }
  };
  const recordConsent = (root: string, workspaceId: string) => writeConsent({ version: 1, workspaceId, root, grantedAt: new Date().toISOString() });
  const revokeConsent = async (root: string) => { await rm(consentPath(resolve(root)), { force: true }); };
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
  const store = async (root: string, inventory: TriageInventory, classification: TriageClassification | undefined, keepInInbox: string[], plan: TriagePlan, leaveInPlace: string[] = []): Promise<Ticket> => {
    await ensureTickets();
    const ticket: Ticket = { version: 1, id: randomUUID(), root, inventory, ...(classification ? { classification } : {}), keepInInbox, ...(leaveInPlace.length ? { leaveInPlace } : {}), plan };
    await writeNew(join(tickets, `${ticket.id}.json`), ticket);
    return ticket;
  };
  const route = (path: string, handler: (ctx: RequestContext) => Promise<unknown>) => addRoute(options.routes, "POST", `/lawoss/triage/${path}`, "host", async ctx => {
    try { return options.jsonResponse(await handler(ctx)); }
    catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof z.ZodError) throw new ApiError(400, "invalid_request", "Invalid triage request.");
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "";
      // `triage_too_large`: klient nad limitmi usporiadania (4 GB, 20 000 súborov); appka ukáže vetu pre advokáta.
      // `triage_locked`: dokument drží Word; nič sa nepresunulo, po jeho zatvorení stačí to isté zopakovať.
      const status = code === "not_trial_clone" ? 403 : code === "triage_conflict" || code === "triage_locked" ? 409 : code === "triage_too_large" ? 413 : 400;
      throw new ApiError(status, code || "triage_failed", error instanceof Error ? error.message : "Triage failed.");
    }
  });

  route("status", async ctx => {
    const { root } = z.strictObject({ root: rootSchema }).parse(await body(ctx));
    try {
      // Skúšobný klon alebo klient so súhlasom na mieste (`grant`); `trial: true` = roztriedenie je tu dovolené.
      const target = await verifyTriageTarget(root, trialJournalDirectory, await hostConsent(root, { status: true }));
      // `canPlan: false` = súhlas sa spotreboval na posledné usporiadanie; ostáva len jeho vrátenie.
      const canPlan = target.mode === "trial" || (await hostConsent(root, { plan: true })).allowInPlace === true;
      // Na mieste sa dá vrátiť len beh, na ktorý sa spotreboval súhlas; nový súhlas vrátenie predošlého behu ruší
      // (rozhodnutie MČ 13. 10.), appka preto „Vrátiť“ ukáže len pri `undoRunId`.
      const undoRunId = target.mode === "in_place" ? (await readConsent(root))?.runId : undefined;
      return { trial: true, mode: target.mode, root: target.root, canPlan, ...(undoRunId ? { undoRunId } : {}), runs: await listTriageRuns(target.root) };
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "";
      if (code === "not_trial_clone") return { trial: false, reason: error instanceof Error ? error.message : "", runs: [] };
      // Cesta k súboru, nečitateľný alebo chýbajúci priečinok: roztriedenie tu nie je, nie chyba požiadavky.
      if (UNAVAILABLE_ROOT.has(code)) return { trial: false, reason: "Priečinok neexistuje alebo sa nedá prečítať.", runs: [] };
      throw error;
    }
  });
  // Výslovný súhlas advokáta s usporiadaním priečinka klienta na mieste („Áno, usporiadaj“).
  // Len pre priečinok, ktorý appka spravuje ako klienta s vlastnými súbormi appky; presuny potom
  // vyžadujú odtlačok potvrdeného náhľadu (`apply`), vrátenie ponechá zmenené dokumenty (`kept`).
  route("grant", async ctx => {
    options.ensureWritable(config);
    const input = z.strictObject({ root: rootSchema, confirm: z.literal(true) }).parse(await body(ctx));
    const root = resolve(input.root);
    const workspace = registeredClient(root);
    if (!workspace) throw new ApiError(403, "not_registered_client", "Only a connected client folder can be reorganised in place.");
    await grantInPlaceReorganize(root);
    await recordConsent(root, workspace.id);
    return { granted: true, root };
  });
  route("plan", async ctx => {
    options.ensureWritable(config);
    // `leaveInPlace`: odškrtnuté priečinky z predošlého náhľadu (prepínač modelu ich nestratí); bez neho predvoľba okf.
    const input = z.strictObject({ root: rootSchema, useModel: z.boolean().optional(), leaveInPlace: LEAVE_SCHEMA.optional() }).parse(await body(ctx));
    const consent = await hostConsent(input.root, { plan: true });
    // Usporiadanie na mieste stojí na pravidlách bez modelu (spec lawOSS-like-SK-CZ#92); návrh modelu len v skúšobnom klone.
    if (input.useModel === true && (await verifyTriageTarget(input.root, trialJournalDirectory, consent)).mode === "in_place") throw new ApiError(400, "triage_model_in_place", "A model proposal is not used when reorganising a client folder in place.");
    const { inventory, plan, proposal, classification } = await prepareTriage(input.root, { trialJournalDirectory, useModelProposal: input.useModel === true, jurisdiction: await options.jurisdiction(), ...(input.leaveInPlace ? { leaveInPlace: input.leaveInPlace } : {}), ...consent });
    if (input.useModel === true && !classification) throw new ApiError(409, "triage_no_model_proposal", "No current model proposal for this folder.");
    return view(await store(inventory.root, inventory, classification, [], plan, plan.matters.filter(matter => matter.left).map(matter => matter.key)), proposal);
  });
  route("replan", async ctx => {
    options.ensureWritable(config);
    const input = z.strictObject({ id: z.uuid(), keepInInbox: z.array(z.string().regex(/^d[a-f0-9]{16}$/)).max(5000), leaveInPlace: LEAVE_SCHEMA.optional() }).parse(await body(ctx));
    const previous = await readTicket(input.id);
    const known = new Set(previous.inventory.documents.map(document => document.id));
    const keep = [...new Set(input.keepInInbox)].filter(id => known.has(id));
    // Odškrtnuté existujúce priečinky (rozhodnutie 19. 10. 2026); neznámy kľúč sa zahodí ako pri `keepInInbox`.
    const folders = new Set(previous.plan.matters.filter(matter => matter.source === "folder").map(matter => matter.key));
    const leave = [...new Set(input.leaveInPlace ?? previous.leaveInPlace ?? [])].filter(key => folders.has(key));
    const classification = previous.classification ? parseClassification(previous.classification, previous.inventory) : undefined;
    const plan = replanTriage(previous.inventory, classification, keep, undefined, leave);
    return view(await store(previous.root, previous.inventory, classification, keep, plan, leave));
  });
  route("apply", async ctx => {
    options.ensureWritable(config);
    const input = z.strictObject({ id: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal(true) }).parse(await body(ctx));
    if (busy.size) throw new ApiError(409, "triage_busy", "Another triage operation is running.");
    busy.add(input.id);
    try {
      const ticket = await readTicket(input.id);
      if (ticket.plan.fingerprint !== input.fingerprint) throw new ApiError(409, "stale_preview", "Preview fingerprint does not match. Create a new preview.");
      const consent = await readConsent(ticket.plan.root);
      const fresh = consent !== undefined && consent.runId === undefined;
      try { return await applyTriagePlan(ticket.plan, { trialJournalDirectory, allowInPlace: fresh }); }
      finally {
        // Súhlas sa spotrebuje, len čo beh má denník (aj pri chybe uprostred), aby sa dal vrátiť a nedal zopakovať.
        if (fresh && (await listTriageRuns(ticket.plan.root).catch(() => [])).some(run => run.runId === ticket.plan.runId)) await writeConsent({ ...consent, runId: ticket.plan.runId });
      }
    } finally { busy.delete(input.id); }
  });
  route("undo", async ctx => {
    options.ensureWritable(config);
    const input = z.strictObject({ root: rootSchema, runId: z.string().regex(/^triage-\d{8}-\d{6}-[a-f0-9]{6}$/), confirm: z.literal(true) }).parse(await body(ctx));
    if (busy.size) throw new ApiError(409, "triage_busy", "Another triage operation is running.");
    busy.add(input.runId);
    try {
      const consent = await hostConsent(input.root, { undo: input.runId });
      const result = await undoTriage(input.root, input.runId, { trialJournalDirectory, ...consent });
      // Po vrátení na mieste súhlas zanikne; ďalšie usporiadanie potrebuje nové potvrdenie advokáta.
      if (consent.allowInPlace === true) await revokeConsent(input.root);
      return result;
    } finally { busy.delete(input.runId); }
  });
}
