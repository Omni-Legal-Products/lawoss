/**
 * LAWOSS: zamietnutá karta nie je chyba nástroja (test alfy 10. 11. 2026).
 *
 * Po „Zamietnuť“ na karte zápisu agent odpovedal „zápis zlyhal“: engine v2 odmietne `context.ask` chybou
 * `Permission.DeclinedError` (alebo `Permission.CorrectedError` s pripomienkou advokáta) a tá sa modelu ukázala
 * ako zlyhanie nástroja. Nástroje LAWOSS s kartou ju preto vrátia ako bežný výsledok „nič sa nezapísalo,
 * lebo ste to zamietli“. `Permission.BlockedError` (zákaz pravidlom) nie je rozhodnutie advokáta a ostáva chybou.
 */

const BLOCKED = /\bPermission\.BlockedError\b/;

/** Everything the error says about itself: its tag, name and message, also through `cause` (Effect wraps typed failures). */
function descriptions(error: unknown, depth = 0): string[] {
  if (typeof error !== "object" || error === null || depth > 3) return [];
  const own = ["_tag", "name", "message"].map(key => Reflect.get(error, key)).filter((value): value is string => typeof value === "string");
  return [...own, ...descriptions(Reflect.get(error, "cause"), depth + 1)];
}

function feedbackOf(error: unknown, depth = 0): string | undefined {
  if (typeof error !== "object" || error === null || depth > 3) return undefined;
  const feedback = Reflect.get(error, "feedback");
  return typeof feedback === "string" && feedback.trim() ? feedback.trim() : feedbackOf(Reflect.get(error, "cause"), depth + 1);
}

/**
 * The user's decision on the card, with their feedback when they gave one; `null` when a rule blocked it.
 * The engine reports the decline to a plugin in a wrapped form (the plugin cannot log it), so every card failure
 * except a rule's block counts as the user's decision: in both cases nothing was written.
 */
export function declinedCard(error: unknown): { feedback?: string } | null {
  if (descriptions(error).some(text => BLOCKED.test(text))) return null;
  const feedback = feedbackOf(error);
  return feedback ? { feedback } : {};
}

/** Ask for the card; a declined card returns the tool text for the model instead of throwing. */
export async function askOrDeclined(ask: () => Promise<unknown>, what: string): Promise<string | null> {
  try {
    await ask();
    return null;
  } catch (error) {
    const declined = declinedCard(error);
    if (!declined) throw error;
    return JSON.stringify({ done: false, declined: true, what, ...declined,
      note: declined.feedback
        ? "The user declined the approval card and gave feedback, so nothing was changed. Follow the feedback; do not call it a failure."
        : "The user declined the approval card, so nothing was changed. Tell them in one short sentence that nothing was saved or changed because they declined; do not call it a failure and do not retry now." });
  }
}
