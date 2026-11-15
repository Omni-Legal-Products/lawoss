/**
 * LAWOSS #434: na otázku „aké integrácie / MCP mám k dispozícii“ agent vymenoval len cloudové konektory LegalWork
 * (Gmail, Outlook, Google Drive, OneDrive, SharePoint, generovanie obrázkov). Tie mu vracia upstream nástroj
 * `legalwork_extension_list_actions`: je to katalóg akcií rozšírení, nie zoznam pripojení, a obsahuje ich, aj keď
 * nič z nich nie je pripojené. Registre a doplnky z LAWOSS Marketplace (ORSR, Judikáty, RÚZ, Slov-Lex, kalkulačky)
 * sú MCP servery, o ktorých model nemal žiadnu vetu, len ich nástroje v zozname.
 *
 * Preto:
 * - pevná veta pre model (nemení sa medzi ťahmi, AGENTS.md „Prompt caching“): integrácie advokáta sú MCP servery
 *   klienta; na otázku o nich zavolať `lawoss_integrations` a vymenovať každý so stavom; cloudové konektory
 *   neponúkať ako dostupné, kým nie sú pripojené (v alfe ich appka neponúka v žiadnom režime, `LEGALWORK_SOURCE_OFFERED`);
 * - `lawoss_integrations`: stav MCP serverov v priečinku chatu z enginu (`ctx.mcp.list`), bez servera a bez karty;
 *   priečinok chatu má MCP spustené, kým v ňom beží chat, takže čítanie nič nové nespúšťa (RAM 2 GB);
 * - výsledok `legalwork_extension_list_actions` sa len doplní poznámkou (upstream nástroj ani jeho akcie sa nemenia,
 *   Pokročilé správanie s pripojeným konektorom ostáva).
 */
import type { Plugin } from "@opencode/plugin";
import { z } from "zod";
import { nativeTool } from "./native-tool.js";

export const INTEGRATIONS_TOOL = "lawoss_integrations";
export const EXTENSION_LISTING_TOOL = "legalwork_extension_list_actions";

/** Fixed text for the model (unchanged between turns, prompt caching). */
export const INTEGRATIONS_SYSTEM = "The lawyer's integrations in LAWOSS are the registers and add-ons installed from the LAWOSS Marketplace (for example the business register ORSR, court decisions, the register of financial statements RÚZ, Slov-Lex and the legal calculators) and any connector the lawyer added; each is an MCP server whose tools carry its name as a prefix (for example orsr_…). When the lawyer asks which integrations, registers, connections or MCP servers are available or connected, call lawoss_integrations and name every server it returns with its state in plain words (connected, turned off, needs sign-in, not working); leave none out and say how many there are. Cloud connectors (Gmail, Outlook mail and calendar, Google Calendar, Google Drive, Google Workspace, OneDrive, SharePoint, image generation) are not part of LAWOSS: do not list or offer them as available integrations, and do not treat the actions from legalwork_extension_list_actions as connected integrations; mention one only if lawoss_integrations shows it connected or the lawyer asks about it by name.";

const STATE: Record<string, string> = {
  connected: "connected",
  disabled: "turned off",
  needs_auth: "needs sign-in",
  needs_client_registration: "needs sign-in",
  failed: "not working",
  pending: "starting",
};

export type IntegrationState = { name: string; state: string; detail?: string };

/** Engine MCP status entries as plain states; unknown states stay visible with their engine name. */
export function integrationStates(servers: readonly { name: string; status: unknown }[]): IntegrationState[] {
  return servers.map(({ name, status }) => {
    const record = typeof status === "object" && status !== null ? status : {};
    const raw = Reflect.get(record, "status");
    const error = Reflect.get(record, "error");
    const state = typeof raw === "string" ? STATE[raw] ?? raw : "unknown";
    return { name, state, ...(state === "not working" && typeof error === "string" && error ? { detail: error.slice(0, 300) } : {}) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function integrationsTool(ctx: Plugin.Context) {
  return nativeTool(ctx, {
    name: INTEGRATIONS_TOOL,
    description: "List the integrations available in this chat: the registers and add-ons from the LAWOSS Marketplace and the lawyer's own connectors (MCP servers of this client's folder), each with its state (connected, turned off, needs sign-in, not working). Read-only, no approval card. Use it whenever the lawyer asks what integrations, registers or connections are available.",
    schema: z.object({}),
    // Read-only status of this chat's own folder: nothing to approve, so no card for its name.
    permission: "domain",
    async execute(_input, context) {
      if (!context.directory) throw new Error("Listing integrations requires a chat in a client's folder.");
      const { data } = await ctx.mcp.list({ location: { directory: context.directory } });
      const integrations = integrationStates(data);
      return JSON.stringify({ count: integrations.length, integrations,
        note: integrations.length ? "These are all integrations of this chat. Name each one with its state." : "No register or add-on is installed for this client. The lawyer can install them in Settings › Integrations › LAWOSS Marketplace." });
    },
  });
}

const LISTING_NOTE = "LAWOSS: this is a catalog of LegalWork cloud connector actions, not a list of the lawyer's integrations; none of them is connected because it appears here. For the lawyer's integrations (registers and add-ons) call lawoss_integrations.";

/** Adds the note to the upstream extension listing without changing its actions. */
export function annotateExtensionListing<T extends { content?: unknown }>(result: T): T {
  const content = result.content;
  if (typeof content === "string") return { ...result, content: `${content}\n\n${LISTING_NOTE}` };
  if (Array.isArray(content)) return { ...result, content: [...content, { type: "text", text: LISTING_NOTE }] };
  return result;
}
