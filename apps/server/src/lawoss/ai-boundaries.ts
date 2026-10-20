import type { AiBoundaries } from "@legalwork/types/ai-governance";
import { ApiError } from "../errors.js";
import { readRuntimeOpencodeConfigText, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";

/**
 * „AI hranice" (owner decision 20. 10. 2026): when enforced, ordinary chat,
 * queues, scheduled sends, reviews, benchmarks, SystemOne, voice and remote
 * OCR are refused before any model request; only protected document
 * generation reaches a model. The alpha ships with them off.
 *
 * Read on every guarded request, so a change applies without a restart.
 * A damaged stored value fails closed (enforced, source `invalid`).
 */
export const GLOBAL_AI_GUIDANCE_ID = "__global_ai_guidance__";

/** Tightening-only lock from this computer's environment for the alpha: "1" forces boundaries on.
 * Not firm policy; a real firm policy key (with its platform mirror) is a follow-up. */
export const AI_BOUNDARIES_DEVICE_ENV = "LAWOSS_AI_BOUNDARIES_ENFORCED";
const ALPHA_DEFAULT = false;
const INVALID: AiBoundaries = {enforced: true, locked: false, source: "invalid"};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function storedBoundaries(text: string | null): AiBoundaries {
  if (text === null) return {enforced: ALPHA_DEFAULT, locked: false, source: "default"};
  let row: unknown;
  try {row = JSON.parse(text);} catch {return INVALID;}
  if (!isRecord(row)) return INVALID;
  const value = row.aiBoundaries;
  if (value === undefined) return {enforced: ALPHA_DEFAULT, locked: false, source: "default"};
  if (!isRecord(value) || typeof value.enforced !== "boolean" || Object.keys(value).length !== 1) return INVALID;
  return {enforced: value.enforced, locked: false, source: "user"};
}

export async function readAiBoundaries(config: ServerConfig): Promise<AiBoundaries> {
  if (process.env[AI_BOUNDARIES_DEVICE_ENV]?.trim() === "1") return {enforced: true, locked: true, source: "device"};
  return storedBoundaries(await readRuntimeOpencodeConfigText(config, GLOBAL_AI_GUIDANCE_ID));
}

export async function writeAiBoundaries(config: ServerConfig, enforced: boolean): Promise<AiBoundaries> {
  if ((await readAiBoundaries(config)).locked && !enforced)
    throw new ApiError(409, "ai_boundaries_locked", "AI boundaries are enforced by a setting of this computer.");
  await writeRuntimeOpencodeConfig(config, GLOBAL_AI_GUIDANCE_ID, current => ({...current, aiBoundaries: {enforced}}));
  return readAiBoundaries(config);
}

/** Other writers of the shared row keep a damaged value damaged (still enforced) instead of resetting it. */
export async function preservedAiBoundaries(config: ServerConfig): Promise<{aiBoundaries?: {invalid: true}}> {
  return storedBoundaries(await readRuntimeOpencodeConfigText(config, GLOBAL_AI_GUIDANCE_ID)).source === "invalid" ? {aiBoundaries: {invalid: true}} : {};
}
