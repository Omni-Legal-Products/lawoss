/**
 * LAWOSS P6 (test 24. 10. 2026, N-A3-6): skrytý pokyn pre model k novému chatu prípadu.
 *
 * Advokát v pripravenej správe vidí len prirodzenú vetu („Pracujeme na prípade … Najprv si prečítaj pamäť
 * prípadu.“). Technické pokyny (skill /okf-pamat, `okf-memory preamble`, zápis bez `--apply`, cesta prípadu)
 * dostane model ako skrytú časť prvej odoslanej správy (`systemReminderPart`, AGENTS.md „Prompt caching“):
 * `openSessionWithPrompt` ich tu uloží k chatu; odoslanie v `session-route.tsx` ich pridá k správe a zabudne
 * ich až po úspešnom odovzdaní enginu (zlyhané prvé odoslanie ich pri opakovaní pošle znova). Len v pamäti
 * procesu, rovnako ako pripravená správa v composeri: po reštarte appky zmizne oboje.
 */
const pending = new Map<string, string>();

/** Keep the hidden context for the first message of this chat. */
export function rememberCaseChatContext(sessionId: string, text: string): void {
  if (sessionId && text.trim()) pending.set(sessionId, text.trim());
}

/** The hidden context for this chat, without removing it: a failed send keeps it for the retry. */
export function peekCaseChatContext(sessionId: string): string | undefined {
  return pending.get(sessionId);
}

/** Forget the hidden context once a message carrying it was handed to the engine. */
export function clearCaseChatContext(sessionId: string): void {
  pending.delete(sessionId);
}
