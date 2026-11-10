import type { UIMessage } from "ai";

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

/** Príznak na časti uvažovania, ktorá vznikla z komentára modelu: hotová správa ju ešte môže ukázať ako odpoveď. */
export const commentaryTag = (part: { type: string }): { commentary?: true } => isModelCommentary(part) ? { commentary: true } : {};

const isCommentaryReasoning = (part: UIMessage["parts"][number]): boolean => part.type === "reasoning"
  && Reflect.get(part.providerMetadata?.opencode ?? {}, "commentary") === true;

/**
 * To isté pravidlo ako `commentaryIsAnswer`, nad časťami pre UI (#269 P3). Živý prenos ukazuje komentár ako
 * uvažovanie; keď engine správu uzavrie ako koniec ťahu bez inej odpovede, prepne ho na text. Inak by advokát naživo
 * nevidel nič a po znovuotvorení chatu komentár. Bez zmeny vráti tú istú správu.
 */
export function withCommentaryAnswer(message: UIMessage, info: AssistantTurnInfo): UIMessage {
  if (!endsTurn(info) || message.parts.some((part) => part.type === "text") || !message.parts.some(isCommentaryReasoning)) return message;
  return { ...message, parts: message.parts.map((part) => part.type === "reasoning" && isCommentaryReasoning(part) ? { ...part, type: "text" as const } : part) };
}

/**
 * Neskorý `message.part.updated` tej istej časti (#348): engine ju stále posiela ako komentár, takže by sa zmapovala
 * späť na uvažovanie a odpoveď by zmizla. Časť, ktorú koniec ťahu (naživo či v načítanom chate) ukázal ako text,
 * ostane textom a vezme si len novší obsah.
 */
export function keepCommentaryAnswer(existing: UIMessage["parts"][number], next: UIMessage["parts"][number]): UIMessage["parts"][number] {
  const answered = existing.type === "text" && Reflect.get(existing.providerMetadata?.opencode ?? {}, "commentary") === true;
  return answered && next.type === "reasoning" && isCommentaryReasoning(next) ? { ...next, type: "text" as const } : next;
}

/**
 * Engine v2 (OpenCode 2.1.4): fáza textu nie je v časti, ale v `native` obsahu správy (výrez metadát poskytovateľa,
 * napr. `{ itemId, phase: "commentary" }`), a pri živom prenose v `session.text.ended`. Upstream projekcia
 * (`@legalwork/types/opencode-view`) ho zahodí; LAWOSS ho vráti do `metadata.native`, odkiaľ ho číta `isModelCommentary`.
 */
export function nativeTextMetadata(native: unknown): { metadata: { native: Record<string, unknown> } } | Record<string, never> {
  return native && typeof native === "object" && !Array.isArray(native) ? { metadata: { native: { ...native } } } : {};
}
