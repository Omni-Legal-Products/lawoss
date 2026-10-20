import { t, type Language } from "@/i18n";

// Only the AI hranice host guard (apps/server/src/lawoss/ai-governance.ts `requireTransferAllowed`)
// sends this text. Protected document generation also uses `ai_transfer_denied` (missing or
// suspended legal profile, missing jurisdiction) with other messages; those must not be told
// that AI hranice are on. The text also survives wrappers that keep only `message`.
const BOUNDARIES_MESSAGE = "Protected AI processing is unavailable";

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
  return typeof error === "string" ? error : "";
}

/** „AI hranice" refused this send: the localized sentence for the lawyer, else null. */
export function aiBoundariesRefusal(error: unknown, locale?: Language): string | null {
  return messageOf(error).includes(BOUNDARIES_MESSAGE) ? t("lawoss.ai_boundaries.chat_refused", locale) : null;
}
