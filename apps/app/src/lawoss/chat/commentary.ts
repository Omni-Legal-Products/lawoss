/**
 * LAWOSS: priebežný komentár modelu nie je odpoveď (N-A5-2, test 25. 10. 2026). Modely OpenAI (Responses API, napr.
 * GPT-6 Luna) posielajú pred nástrojmi text vo fáze `commentary` („We have memory links relative to project root…“);
 * engine ho ukladá ako textovú časť s `metadata.openai.phase`. Appka ho ukazovala ako odpoveď, hoci je to vnútorné
 * uvažovanie modelu, často po anglicky. Ukáže sa ako uvažovanie: skryté, kým advokát nezapne „Zobraziť uvažovanie“.
 * Volá ho `session-sync.ts` (živý prenos) aj `usechat-adapter.ts` (načítaný chat), PATCHES.md.
 */
export function isModelCommentary(part: { type: string }): boolean {
  if (part.type !== "text") return false;
  const metadata: unknown = Reflect.get(part, "metadata");
  const openai: unknown = metadata && typeof metadata === "object" ? Reflect.get(metadata, "openai") : undefined;
  return Boolean(openai && typeof openai === "object" && Reflect.get(openai, "phase") === "commentary");
}
