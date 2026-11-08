// LAWOSS: N7. Krátky výpadok siete pri sťahovaní doplnku z GitHubu nesmie skončiť
// všeobecným „Unexpected server error“. Jedno opakovanie pokryje prechodný výpadok,
// potom dostane appka vlastný kód a môže používateľovi poradiť, čo spraviť.
import { ApiError } from "../errors.js";

const REQUEST_TIMEOUT_MS = 20_000;
/** Druhý pokus je kratší: sieť, ktorá požiadavky len drží (captive portál), inak zdrží každý súbor o 40 s. */
const RETRY_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 500;

export async function fetchPluginSource(
  url: string,
  init: Omit<RequestInit, "signal">,
  options: { fetch?: typeof fetch; retryDelayMs?: number } = {},
): Promise<Response> {
  const request = options.fetch ?? fetch;
  try {
    return await request(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? RETRY_DELAY_MS));
  }
  try {
    return await request(url, { ...init, signal: AbortSignal.timeout(RETRY_TIMEOUT_MS) });
  } catch {
    throw new ApiError(503, "plugin_source_unreachable", "Could not reach the plugin source. Check the connection and try again.");
  }
}
