/**
 * Pripojenie onboardingu k lokálnemu serveru LAWOSS.
 *
 * Pri prvom štarte sa uvítacia stránka otvorí skôr, než boot spustí server a pošle
 * `legalwork-server-settings-changed`. Prázdne pripojenie preto znamená „ešte sa pripája“:
 * čaká sa na udalosť a chyba sa ukáže až po uplynutí `timeoutMs`.
 */
export type LegalworkConnectionLike = {
  normalizedBaseUrl: string;
  resolvedToken: string;
  resolvedHostToken: string;
};

export const LEGALWORK_SETTINGS_CHANGED = "legalwork-server-settings-changed";
const UNAVAILABLE = "LAWOSS server is unavailable";

export function watchLegalworkConnection(options: {
  resolve: () => Promise<LegalworkConnectionLike>;
  onReady: (connection: LegalworkConnectionLike) => void;
  onUnavailable: (message: string) => void;
  target?: EventTarget;
  timeoutMs?: number;
}): () => void {
  const target = options.target ?? window;
  let done = false;
  const stop = () => {
    done = true;
    clearTimeout(timer);
    target.removeEventListener(LEGALWORK_SETTINGS_CHANGED, attempt);
  };
  const fail = (message: string) => {
    if (done) return;
    stop();
    options.onUnavailable(message);
  };
  function attempt() {
    void options.resolve().then(connection => {
      if (done || !connection.normalizedBaseUrl || !(connection.resolvedToken || connection.resolvedHostToken)) return;
      stop();
      options.onReady(connection);
    }).catch((reason: unknown) => fail(reason instanceof Error ? reason.message : String(reason)));
  }
  const timer = setTimeout(() => fail(UNAVAILABLE), options.timeoutMs ?? 30_000);
  target.addEventListener(LEGALWORK_SETTINGS_CHANGED, attempt);
  attempt();
  return stop;
}
