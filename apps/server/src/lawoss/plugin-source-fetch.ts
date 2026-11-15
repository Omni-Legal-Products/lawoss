// LAWOSS: N7. Krátky výpadok siete pri sťahovaní doplnku z GitHubu nesmie skončiť
// všeobecným „Unexpected server error“. Jedno opakovanie pokryje prechodný výpadok,
// potom dostane appka vlastný kód a môže používateľovi poradiť, čo spraviť.
import { ApiError } from "../errors.js";

const REQUEST_TIMEOUT_MS = 20_000;
/** Druhý pokus je kratší: sieť, ktorá požiadavky len drží (captive portál), inak zdrží každý súbor o 40 s. */
const RETRY_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 500;

/**
 * #420: limit platí na nečinnosť, nie na celé sťahovanie. Pribalený runtime registra má až
 * 8 MiB; pevný limit na celú odpoveď by ho na pomalšej linke prerušil uprostred tela
 * (`response.text()` volajúceho, mimo opakovania a bez vlastného kódu). Telo sa preto prečíta
 * tu: každý prijatý kus posunie limit, výpadok tela sa opakuje ako výpadok spojenia.
 */
async function attempt(request: typeof fetch, url: string, init: Omit<RequestInit, "signal">, idleMs: number): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new DOMException("Plugin source stalled", "TimeoutError")), idleMs);
  };
  arm();
  try {
    const response = await request(url, { ...init, signal: controller.signal });
    if (!response.body) return response;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      arm();
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPluginSource(
  url: string,
  init: Omit<RequestInit, "signal">,
  options: { fetch?: typeof fetch; retryDelayMs?: number; idleTimeoutMs?: number; retryIdleTimeoutMs?: number } = {},
): Promise<Response> {
  const request = options.fetch ?? fetch;
  try {
    return await attempt(request, url, init, options.idleTimeoutMs ?? REQUEST_TIMEOUT_MS);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? RETRY_DELAY_MS));
  }
  try {
    return await attempt(request, url, init, options.retryIdleTimeoutMs ?? RETRY_TIMEOUT_MS);
  } catch {
    throw new ApiError(503, "plugin_source_unreachable", "Could not reach the plugin source. Check the connection and try again.");
  }
}
