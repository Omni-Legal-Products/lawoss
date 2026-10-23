/**
 * LAWOSS P6 (test 24. 10. 2026, N-A3-6): skrytý pokyn pre model k novému chatu prípadu.
 *
 * Advokát v pripravenej správe vidí len prirodzenú vetu („Pracujeme na prípade … Najprv si prečítaj pamäť
 * prípadu.“). Technické pokyny (skill /okf-pamat, `okf-memory preamble`, zápis bez `--apply`, cesta prípadu)
 * dostane model ako skrytú časť prvej odoslanej správy (`systemReminderPart`, AGENTS.md „Prompt caching“):
 * `openSessionWithPrompt` ich tu uloží k chatu a odoslanie v `session-route.tsx` ich raz vyberie.
 * Len v pamäti procesu: po reštarte appky sa pripravená správa odošle bez nich a model sa riadi skillom
 * a AGENTS.md prípadu.
 */
const pending = new Map<string, string>();

/** Keep the hidden context for the first message of this chat. */
export function rememberCaseChatContext(sessionId: string, text: string): void {
  if (sessionId && text.trim()) pending.set(sessionId, text.trim());
}

/** The hidden context for this chat, once: the first send takes it. */
export function takeCaseChatContext(sessionId: string): string | undefined {
  const text = pending.get(sessionId);
  pending.delete(sessionId);
  return text;
}
