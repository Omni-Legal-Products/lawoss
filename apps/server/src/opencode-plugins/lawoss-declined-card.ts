/**
 * LAWOSS: zamietnutá karta nie je chyba nástroja (test alfy 10. 11. 2026).
 *
 * Po „Zamietnuť“ na karte zápisu agent odpovedal „zápis zlyhal“: engine v2 odmietne `context.ask` chybou
 * `Permission.DeclinedError` (alebo `Permission.CorrectedError` s pripomienkou advokáta) a tá sa modelu ukázala
 * ako zlyhanie nástroja. Nástroje LAWOSS s kartou ju preto vrátia ako bežný výsledok „nič sa nezapísalo,
 * lebo ste to zamietli“. `Permission.BlockedError` (zákaz pravidlom) nie je rozhodnutie advokáta a ostáva chybou.
 */

const DECLINED_TAGS = new Set(["Permission.DeclinedError", "Permission.CorrectedError", "RejectedError", "CorrectedError"]);

/** The user's decision on the card, with their feedback when they gave one; `null` for any other error. */
export function declinedCard(error: unknown): { feedback?: string } | null {
  if (typeof error !== "object" || error === null) return null;
  const tag = [Reflect.get(error, "_tag"), Reflect.get(error, "name")].find(value => typeof value === "string" && DECLINED_TAGS.has(value));
  if (!tag) return null;
  const feedback = Reflect.get(error, "feedback");
  return typeof feedback === "string" && feedback.trim() ? { feedback: feedback.trim() } : {};
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
