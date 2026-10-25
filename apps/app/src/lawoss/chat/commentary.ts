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

/**
 * Hotová správa bez inej odpovede (prerušená, chyba, limit krokov hneď po komentári): komentár ostane textom, aby
 * advokát nevidel kroky bez slova odpovede (review N-A5-2).
 */
export function commentaryIsAnswer(parts: readonly { type: string }[], completed: boolean): boolean {
  return completed && !parts.some((part) => part.type === "text" && !isModelCommentary(part)
    && !Reflect.get(part, "synthetic") && !Reflect.get(part, "ignored"));
}
