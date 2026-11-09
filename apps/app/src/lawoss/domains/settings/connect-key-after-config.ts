/**
 * LAWOSS: kľúč nového vlastného poskytovateľa sa uloží až po tom, čo engine prevezme jeho konfiguráciu.
 *
 * Engine v2 preberá zmenu konfigurácie cez sledovanie súborov, teda s oneskorením (upstream
 * `managed-engine-settings.released.test.ts` čaká až 10 s). Nastavenia hneď po zápise konfigurácie volajú
 * `model.list` a `integration.connect.key`; nový poskytovateľ v lokalite ešte nemusí existovať a engine
 * odpovie `IntegrationNotFoundError` (404, pozorované v teste ISIR na 2.1.4). Pomôcka preto pri tejto
 * jedinej chybe zopakuje obnovu katalógu a uloženie kľúča, kým neuplynie limit. Iné chyby ani chyba po
 * limite sa neprehĺtajú.
 */

export const CONNECT_KEY_AFTER_CONFIG_DEADLINE_MS = 10_000;
const RETRY_INTERVAL_MS = 200;

type Options = { deadlineMs?: number; intervalMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Odpoveď enginu „poskytovateľ v lokalite neexistuje“ (typovaná chyba protokolu, HTTP 404). */
export function isIntegrationNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "_tag" in error && error._tag === "IntegrationNotFoundError";
}

/** Obnoví katalóg a uloží kľúč; pri `IntegrationNotFoundError` to zopakuje do limitu. */
export async function connectKeyAfterConfig(refresh: () => Promise<unknown>, connect: () => Promise<unknown>, options: Options = {}): Promise<void> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = now() + (options.deadlineMs ?? CONNECT_KEY_AFTER_CONFIG_DEADLINE_MS);
  for (;;) {
    await refresh();
    try {
      await connect();
      return;
    } catch (error) {
      if (!isIntegrationNotFound(error) || now() >= deadline) throw error;
    }
    await sleep(options.intervalMs ?? RETRY_INTERVAL_MS);
  }
}
