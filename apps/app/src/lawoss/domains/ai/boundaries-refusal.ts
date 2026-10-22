import { AI_BOUNDARIES_DENIAL_SOURCE } from "@legalwork/types/ai-governance";
import { t, type Language } from "@/i18n";

const DENIED_CODE = "ai_transfer_denied";
// Fallback only: the AI hranice guard's fixed server text (apps/server/src/lawoss/ai-governance.ts)
// survives where the typed error is lost, e.g. a queue entry refused at delivery keeps only
// `message`. Protected document generation also uses `ai_transfer_denied`, with other texts
// and without the marker, and must not be described as AI hranice.
const BOUNDARIES_MESSAGE = "Protected AI processing is unavailable";
/**
 * Language-neutral stand-in kept where an error is stored (component state, the
 * session activity store). It is recognised again by `aiBoundariesRefusal`, so the
 * sentence for the lawyer is produced at render time in the current language.
 */
export const AI_BOUNDARIES_STORED_MESSAGE = BOUNDARIES_MESSAGE;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function markedDenial(value: unknown): boolean {
  return isRecord(value) && value.code === DENIED_CODE && isRecord(value.details) && value.details.source === AI_BOUNDARIES_DENIAL_SOURCE;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return typeof error === "string" ? error : "";
}

function parsedMarker(message: string): boolean {
  try {return markedDenial(JSON.parse(message));} catch {return false;}
}

/** „AI hranice" refused this send: the localized sentence for the lawyer, else null. */
export function aiBoundariesRefusal(error: unknown, locale?: Language): string | null {
  const message = messageOf(error);
  const refused = markedDenial(error) || parsedMarker(message) || message.includes(BOUNDARIES_MESSAGE);
  return refused ? t("lawoss.ai_boundaries.chat_refused", locale) : null;
}
