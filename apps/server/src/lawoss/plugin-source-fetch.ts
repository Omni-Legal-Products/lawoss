// LAWOSS: N7. Krátky výpadok siete pri sťahovaní doplnku z GitHubu nesmie skončiť
// všeobecným „Unexpected server error“. Jedno opakovanie pokryje prechodný výpadok,
// potom dostane appka vlastný kód a môže používateľovi poradiť, čo spraviť.
import { ApiError } from "../errors.js";

const MIB = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
/** Druhý pokus je kratší: sieť, ktorá požiadavky len drží (captive portál), inak zdrží každý súbor o 40 s. */
const RETRY_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 500;
/**
 * #420: pevný strop na jeden súbor vrátane opakovania (popri limite nečinnosti), aby server, ktorý
 * posiela bajt raz za 19 s, nedržal spojenie donekonečna. 300 s: súbor 8 MiB trvá na 1 Mbit/s ~67 s,
 * ale až šesť súbegov delí linku, takže celý balík 24 MiB (~201 s na 1 Mbit/s) sa zmestí aj vtedy,
 * keď najväčší súbor beží súčasne s ostatnými.
 */
export const PLUGIN_SOURCE_DEADLINE_MS = 300_000;
/** Strop pre odpovede bez vlastného limitu (strom repozitára, manifest, skilly); strom GitHubu má najviac ~7 MB. */
export const PLUGIN_SOURCE_DEFAULT_MAX_BYTES = 32 * MIB;

/** Telo je väčšie ako povolený limit. Neopakuje sa; importér ho prevedie na vlastnú chybu. */
export class PluginSourceTooLargeError extends ApiError {
  constructor(readonly maxBytes: number) {
    super(400, "plugin_source_too_large", `Plugin source exceeds ${maxBytes} bytes`);
  }
}

export type PluginSourceOptions = {
  fetch?: typeof fetch;
  retryDelayMs?: number;
  idleTimeoutMs?: number;
  retryIdleTimeoutMs?: number;
  /** Strop na celé sťahovanie súboru vrátane opakovania. */
  deadlineMs?: number;
  /** Najviac bajtov tela; prekročenie preruší sťahovanie hneď, nie až po načítaní celého tela. */
  maxBytes?: number;
  /** Zrušenie zvonka (napríklad iný súbor balíka už prekročil limit). */
  signal?: AbortSignal;
};

type AttemptContext = { idleMs: number; maxBytes: number; signals: AbortSignal[] };

/**
 * #420: limit platí na nečinnosť, nie na celé sťahovanie. Pribalený runtime registra má až
 * 8 MiB; pevný limit na celú odpoveď by ho na pomalšej linke prerušil uprostred tela
 * (`response.text()` volajúceho, mimo opakovania a bez vlastného kódu). Telo sa preto prečíta
 * tu: každý prijatý kus posunie limit, výpadok tela sa opakuje ako výpadok spojenia.
 * Počet bajtov sa stráži počas čítania; Content-Length je len rýchle odmietnutie vopred
 * (pri kompresii môže byť menší ako rozbalené telo).
 */
async function attempt(request: typeof fetch, url: string, init: Omit<RequestInit, "signal">, context: AttemptContext): Promise<Response> {
  const controller = new AbortController();
  const forward = (signal: AbortSignal) => () => controller.abort(signal.reason);
  const listeners = context.signals.map((signal) => {
    const listener = forward(signal);
    if (signal.aborted) listener();
    else signal.addEventListener("abort", listener, { once: true });
    return { signal, listener };
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new DOMException("Plugin source stalled", "TimeoutError")), context.idleMs);
  };
  arm();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let complete = false;
  try {
    const response = await request(url, { ...init, signal: controller.signal });
    const declared = Number(response.headers.get("content-length") ?? NaN);
    if (Number.isFinite(declared) && declared > context.maxBytes) throw new PluginSourceTooLargeError(context.maxBytes);
    if (!response.body) {
      complete = true;
      return response;
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      arm();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > context.maxBytes) throw new PluginSourceTooLargeError(context.maxBytes);
      chunks.push(value);
    }
    complete = true;
    return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally {
    clearTimeout(timer);
    for (const { signal, listener } of listeners) signal.removeEventListener("abort", listener);
    // Pri chybe uprostred tela sa spojenie zavrie, nečaká sa na ďalšie bajty.
    if (!complete) {
      controller.abort(new DOMException("Plugin source aborted", "AbortError"));
      void reader?.cancel().catch(() => undefined);
    }
  }
}

const unreachable = () => new ApiError(503, "plugin_source_unreachable", "Could not reach the plugin source. Check the connection and try again.");

export async function fetchPluginSource(url: string, init: Omit<RequestInit, "signal">, options: PluginSourceOptions = {}): Promise<Response> {
  const request = options.fetch ?? fetch;
  const maxBytes = options.maxBytes ?? PLUGIN_SOURCE_DEFAULT_MAX_BYTES;
  const deadline = new AbortController();
  const deadlineTimer = setTimeout(
    () => deadline.abort(new DOMException("Plugin source download took too long", "TimeoutError")),
    options.deadlineMs ?? PLUGIN_SOURCE_DEADLINE_MS,
  );
  const signals = options.signal ? [deadline.signal, options.signal] : [deadline.signal];
  // Prekročený limit a zrušenie zvonka sa neopakujú; uplynutý strop už nedovolí ďalší pokus.
  const final = (error: unknown): unknown => {
    if (error instanceof PluginSourceTooLargeError) return error;
    if (options.signal?.aborted) return options.signal.reason ?? new DOMException("Plugin source aborted", "AbortError");
    return deadline.signal.aborted ? unreachable() : null;
  };
  try {
    try {
      return await attempt(request, url, init, { idleMs: options.idleTimeoutMs ?? REQUEST_TIMEOUT_MS, maxBytes, signals });
    } catch (error) {
      const stop = final(error);
      if (stop) throw stop;
      await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? RETRY_DELAY_MS));
    }
    try {
      return await attempt(request, url, init, { idleMs: options.retryIdleTimeoutMs ?? RETRY_TIMEOUT_MS, maxBytes, signals });
    } catch (error) {
      throw final(error) ?? unreachable();
    }
  } finally {
    clearTimeout(deadlineTimer);
  }
}
