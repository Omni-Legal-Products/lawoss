/**
 * LAWOSS #423: nový klient vetou v chate („založ nového klienta Novák s. r. o.“).
 *
 * Skill /novy-spis smie písať len do priečinka chatu, a priečinok nového klienta leží mimo každého klienta, preto agent
 * odmietal. Nástroj `lawoss_new_client` založí klienta tou istou cestou servera ako formulár klienta (`lawoss/onboarding.ts`:
 * plán z profilu kancelárie, potom vykonanie, registrácia klienta a povolenie pamäti kancelárie). Agent cestu nezadáva:
 * kanceláriu, priečinok `Klienti`, jurisdikciu a jazyk berie server z profilu. Jedna karta enginu s povolením
 * `lawoss_file_change` (ako `lawoss_files`: predvolene „pýtať sa“, v YOLO bez karty) ukáže presný priečinok, ktorý vznikne;
 * zamietnutie nezapíše nič (engine ho dostane ako rozhodnutie advokáta, pevný text povie modelu, čo povedať). Existujúci priečinok sa nikdy neprepíše: server vráti kolíziu mena ešte pred kartou.
 */
import type { Plugin } from "@opencode/plugin";
import { z } from "zod";
import { chatWorkspace } from "./lawoss-file-paths.js";
import { listWorkspaces, serverUrl, workspaceToolHeaders, type OpenCodeContext } from "./office-plugin-shared.js";
import { nativeTool } from "./native-tool.js";
import { askOrDeclined } from "./lawoss-declined-card.js";

export const NEW_CLIENT_TOOL = "lawoss_new_client";

const args = z.object({
  name: z.string().trim().min(1).max(120).describe("The client's name as the lawyer said it, e.g. \"Novák s. r. o.\" or \"Ján Novák\". It becomes the client's folder and the title of the client card."),
  client_type: z.enum(["fo", "fo-podnikatel", "po", "iny"]).optional().describe("po: a company or other legal person (default), fo: a private person, fo-podnikatel: a sole trader, iny: other. Only when the lawyer's words make it clear."),
  ico: z.string().regex(/^\d{6,8}$/).optional().describe("The identification number (IČO) if the lawyer gave it, digits only."),
  note: z.string().trim().min(1).max(1000).optional().describe("A short note about the client for the client card, only if the lawyer gave one."),
});

/** Fixed text for the model (unchanged between turns, prompt caching). */
export const NEW_CLIENT_SYSTEM = "To create a new client of the office (for example: create a new client Novák s. r. o.), call lawoss_new_client with the client's name, and the identification number or a short note only if the lawyer gave them. It works in every client's chat: the new client is created in the office's clients folder with one approval card. Never create a client's folder or client card by hand, with okf apply klient or with lawoss_files. Checking the company in the business registers first is optional: do it only when the lawyer asks. If the lawyer declines the card, say plainly that no client was created and do not retry.";

const refusal = z.object({ code: z.string().optional(), message: z.string().optional() });

async function post(context: OpenCodeContext, workspace: string, route: "plan" | "apply", body: unknown): Promise<{ ok: true; data: unknown } | { ok: false; code: string; message: string }> {
  const response = await fetch(`${serverUrl()}/workspace/${encodeURIComponent(workspace)}/lawoss/new-client/${route}`, {
    method: "POST", headers: { ...await workspaceToolHeaders(context), "Content-Type": "application/json" }, body: JSON.stringify(body),
    signal: context.abort ? AbortSignal.any([context.abort, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
  });
  const text = await response.text();
  if (response.ok) return { ok: true, data: JSON.parse(text) };
  const parsed = refusal.safeParse((() => { try { return JSON.parse(text); } catch { return null; } })());
  return { ok: false, code: parsed.success ? parsed.data.code ?? `http_${response.status}` : `http_${response.status}`, message: parsed.success ? parsed.data.message ?? text : text };
}

const NOTES: Record<string, string> = {
  new_client_no_office: "No office is connected, so no client was created. Tell the lawyer plainly that nothing was created and that they first need to connect their office in LAWOSS.",
  new_client_exists: "A folder with this name already exists in the office's clients folder, so nothing was created or overwritten. Tell the lawyer, and ask whether they mean the existing client or want a different name.",
};

const planned = z.object({ id: z.string(), fingerprint: z.string(), office: z.string(), target: z.string(), name: z.string() });

export async function createClient(input: z.output<typeof args>, context: OpenCodeContext): Promise<string> {
  if (!context.sessionID || !context.directory) throw new Error("Creating a client requires a chat in a client's folder.");
  const ask = context.ask;
  if (!ask) throw new Error("Creating a client needs the user's approval, but approval requests are unavailable.");
  const own = chatWorkspace(await listWorkspaces(context), context.directory);
  if (!own) throw new Error("This chat is not in a registered client's folder.");
  const plan = await post(context, own.id, "plan", { name: input.name, ...(input.client_type ? { clientType: input.client_type } : {}),
    ...(input.ico ? { ico: input.ico } : {}), ...(input.note ? { note: input.note } : {}) });
  if (!plan.ok) return JSON.stringify({ created: false, code: plan.code, error: plan.message, note: NOTES[plan.code] ?? "Nothing was created. Tell the lawyer in one sentence what went wrong and what they can do next." });
  const preview = planned.parse(plan.data);
  // The same card as lawoss_files: one new folder at its full path (file-operation-card.ts), the client in the reason.
  const reason = `${preview.name}${input.ico ? ` (IČO ${input.ico})` : ""}`;
  const declined = await askOrDeclined(() => ask({ permission: "lawoss_file_change", patterns: [preview.target], always: [],
    metadata: { lawossFiles: [{ operation: "create_folder", kind: "folder", to: preview.target }], description: reason } }), preview.target);
  if (declined) return declined;
  const applied = await post(context, own.id, "apply", { id: preview.id, fingerprint: preview.fingerprint, sessionID: context.sessionID });
  if (!applied.ok) return JSON.stringify({ created: false, code: applied.code, error: applied.message, note: "The client could not be created. Tell the lawyer in one sentence; do not retry on your own." });
  const result = z.object({ path: z.string(), name: z.string() }).parse(applied.data);
  return JSON.stringify({ created: true, path: result.path, name: result.name,
    note: "Tell the lawyer that the client was created in the office and now appears in the client list, where they can open it and start working in its chat." });
}

export function newClientTool(ctx: Plugin.Context) {
  return nativeTool(ctx, {
    name: NEW_CLIENT_TOOL,
    description: "Create a new client of the connected office: its folder in the office's clients folder with the client card and the office standard files, registered as a client like the client form in LAWOSS. Shows the user one approval card with the exact folder (no card when YOLO Mode is on); a declined card creates nothing. Refuses when no office is connected or when a folder with this name already exists; never overwrites anything.",
    schema: args,
    // The tool asks its own `lawoss_file_change` card with the folder; no second card for its name.
    permission: "domain",
    execute: createClient,
  });
}
