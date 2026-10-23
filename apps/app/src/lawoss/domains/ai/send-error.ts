import { t, type Language } from "@/i18n";
import { aiBoundariesRefusal } from "./boundaries-refusal";

/**
 * A failed send stored as a kind, not as translated text: the sentence is
 * produced at render time, so it follows a language switch made afterwards.
 */
export type SendError = { kind: "ai-boundaries" } | { kind: "failed" } | { kind: "message"; message: string };

export function sendErrorFromThrown(thrown: unknown): SendError {
  if (aiBoundariesRefusal(thrown)) return { kind: "ai-boundaries" };
  return thrown instanceof Error ? { kind: "message", message: thrown.message } : { kind: "failed" };
}

export function sendErrorText(error: SendError, locale?: Language): string {
  if (error.kind === "ai-boundaries") return t("lawoss.ai_boundaries.chat_refused", locale);
  return error.kind === "message" ? error.message : t("home.send_failed", locale);
}
