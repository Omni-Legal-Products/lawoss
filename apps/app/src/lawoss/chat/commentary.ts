/**
 * LAWOSS: priebežný komentár modelu nie je odpoveď (N-A5-2, test 25. 10. 2026). Modely OpenAI (Responses API, napr.
 * GPT-6 Luna) posielajú pred nástrojmi text vo fáze `commentary` („We have memory links relative to project root…“);
 * engine ho ukladá ako textovú časť s `metadata.openai.phase`. Appka ho ukazovala ako odpoveď, hoci je to vnútorné
 * uvažovanie modelu, často po anglicky. Ukáže sa ako uvažovanie: skryté, kým advokát nezapne „Zobraziť uvažovanie
 * modelu“. Fáza je pod menom poskytovateľa (`openai`, ale aj Azure či iný kompatibilný), preto sa číta pri každom.
 * Volá ho `session-sync.ts` (živý prenos) aj `usechat-adapter.ts` (načítaný chat), PATCHES.md.
 */
export function isModelCommentary(part: { type: string }): boolean {
  if (part.type !== "text") return false;
  const metadata: unknown = Reflect.get(part, "metadata");
  if (!metadata || typeof metadata !== "object") return false;
  return Object.values(metadata).some((provider: unknown) => Boolean(provider && typeof provider === "object" && Reflect.get(provider, "phase") === "commentary"));
}

/** Polia `info` správy z engine, z ktorých sa číta, či končí ťah (správa používateľa ťah nekončí, nemá `completed`). */
type AssistantTurnInfo = { finish?: unknown; error?: unknown; time?: { created?: unknown; completed?: unknown } };

/**
 * Správa končí ťah, keď je hotová a nie je len krokom s nástrojom: opencode ukladá každý krok ako hotovú správu
 * s `finish` „tool-calls“ (či „unknown“) a odpoveď príde až v ďalšej (#269). Chyba ťah ukončí vždy. Rovnaké pravidlo
 * ako pri koncovej odpovedi v `session-sync.ts`, len chýbajúci `finish` (staršie správy) sa berie ako koniec.
 */
const endsTurn = (info: AssistantTurnInfo): boolean => typeof info.time?.completed === "number"
  && (Boolean(info.error) || (info.finish !== "tool-calls" && info.finish !== "unknown"));

/**
 * Správa, ktorá končí ťah bez inej odpovede (prerušená, chyba, limit krokov hneď po komentári): komentár ostane
 * textom, aby advokát nevidel kroky bez slova odpovede (review N-A5-2).
 */
export function commentaryIsAnswer(parts: readonly { type: string }[], info: AssistantTurnInfo): boolean {
  return endsTurn(info) && !parts.some((part) => part.type === "text" && !isModelCommentary(part)
    && !Reflect.get(part, "synthetic") && !Reflect.get(part, "ignored"));
}
