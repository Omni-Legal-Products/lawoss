/**
 * LAWOSS #542: klient, ktorého uložený riadok nastavení sa nedá bezpečne prečítať, zostane zablokovaný len on.
 *
 * Konfigurácia enginu je jeden spoločný súbor pre všetkých klientov. Poškodený riadok jedného klienta preto do súboru
 * nepatrí, ale nesmie zastaviť publikovanie ostatných. Klient bez záznamu v súbore nastavení enginu dostane od pluginu
 * `legalwork-managed-config` zamietnutie každého oprávnenia, takže nedostane viac, než mal. Riadok sa neprepíše sám;
 * každé čítanie nastavení tohto klienta končí chybou 409 `execution_settings_invalid`, kým ho advokát výslovne neobnoví
 * (#554, `repairClientSettings`).
 */
import { z } from "zod";
import { ApiError } from "../errors.js";
import { addRoute, type Route } from "../routes/registry.js";
import { readRuntimeOpencodeConfig, repairApplicationRuntimeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";

export const UNREADABLE_CLIENT_SETTINGS_CODE = "execution_settings_invalid";

export async function clientSettingsReadable(config: ServerConfig, workspaceId: string): Promise<boolean> {
  try {
    await readRuntimeOpencodeConfig(config, workspaceId);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.code === UNREADABLE_CLIENT_SETTINGS_CODE) return false;
    throw error;
  }
}

export function warnUnreadableClientSettings(workspaceId: string): void {
  console.warn(`[lawoss] Saved settings of client ${workspaceId} cannot be read safely; the client stays blocked and is left out of the engine settings.`);
}

/** #554: odpoveď o projekte klienta (`GET /workspace/:id/project`) povie appke, že jeho nastavenia sú poškodené. */
export async function withClientSettingsState<T extends object>(config: ServerConfig, workspaceId: string, details: T): Promise<T | T & {lawossClientSettingsUnreadable: true}> {
  return await clientSettingsReadable(config, workspaceId) ? details : {...details, lawossClientSettingsUnreadable: true};
}

/** #554: po potvrdení advokáta nahradí nečitateľný riadok klienta predvolenými nastaveniami (ako nový klient).
 * Originál ostane v záložnej tabuľke v tej istej transakcii; čitateľný riadok sa nemení. */
export async function repairClientSettings(config: ServerConfig, workspaceId: string): Promise<void> {
  if (await clientSettingsReadable(config, workspaceId))
    throw new ApiError(409, "client_settings_not_damaged", "This client's settings are readable; nothing to repair.");
  await repairApplicationRuntimeConfig(config, workspaceId, current => current, {code: "client_settings_repaired", fields: ["configuration"]});
}

export function registerClientSettingsRoutes(options: {routes: Route[]; config: ServerConfig;
  jsonResponse: (value: unknown, status?: number) => Response;
  readJsonBodyLimited: (request: Request, maxBytes: number) => Promise<Record<string, unknown>>;
  ensureWritable: (config: ServerConfig) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>}) {
  const {config} = options;
  addRoute(options.routes, "POST", "/workspace/:id/lawoss/client-settings/repair", "host-token", async ctx => {
    options.ensureWritable(config);
    const parsed = z.strictObject({confirmed: z.literal(true)}).safeParse(await options.readJsonBodyLimited(ctx.request, 1024));
    if (!parsed.success) throw new ApiError(400, "invalid_client_settings_repair", "Confirm the repair of this client's damaged settings.");
    const workspace = await options.resolveWorkspace(config, ctx.params.id);
    await repairClientSettings(config, workspace.id);
    return options.jsonResponse({repaired: true});
  });
}
