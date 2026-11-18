/**
 * LAWOSS #542: klient, ktorého uložený riadok nastavení sa nedá bezpečne prečítať, zostane zablokovaný len on.
 *
 * Konfigurácia enginu je jeden spoločný súbor pre všetkých klientov. Poškodený riadok jedného klienta preto do súboru
 * nepatrí, ale nesmie zastaviť publikovanie ostatných. Klient bez záznamu v súbore nastavení enginu dostane od pluginu
 * `legalwork-managed-config` zamietnutie každého oprávnenia, takže nedostane viac, než mal. Riadok sa nikdy neprepíše
 * a každé čítanie nastavení tohto klienta naďalej končí chybou 409 `execution_settings_invalid`.
 */
import { ApiError } from "../errors.js";
import { readRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";

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
