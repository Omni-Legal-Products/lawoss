import type { SessionPromptData, TextPartInput } from "@opencode-ai/sdk/v2/client";

/**
 * Context for one turn (attachment instructions, environment variable names,
 * the Fusion trace), sent as a hidden part of the user's message.
 *
 * Not as the prompt's `system` field: the engine appends that to the system
 * prompt, which then changes from turn to turn and discards the provider's
 * prompt cache for the whole conversation. A message part is saved with the
 * turn, so every later request repeats it unchanged. The chat view hides
 * synthetic parts.
 */
export function systemReminderPart(text: string): TextPartInput {
  return { type: "text", text: `<system-reminder>\n${text}\n</system-reminder>`, synthetic: true };
}

type SessionPromptRequest = Pick<NonNullable<SessionPromptData["body"]>, "model" | "agent" | "variant" | "parts"> & {
  sessionID: string;
  reasoning_effort?: string;
};

/** Shared by the app send paths and the whole-agent cache regression test. */
export function buildSessionPromptRequest(input: SessionPromptRequest, context?: string) {
  const text = context?.trim();
  return {
    sessionID: input.sessionID,
    model: input.model,
    agent: input.agent,
    variant: input.variant,
    ...(input.reasoning_effort ? { reasoning_effort: input.reasoning_effort } : {}),
    parts: text ? [...input.parts, systemReminderPart(text)] : input.parts,
  };
}
