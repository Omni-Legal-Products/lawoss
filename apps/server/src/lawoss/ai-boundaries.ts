import type { AiBoundaries } from "@legalwork/types/ai-governance";
import { ApiError } from "../errors.js";
import { readRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";

/**
 * „AI hranice" (owner decision 20. 10. 2026): when enforced, ordinary chat,
 * queues, scheduled sends, reviews, benchmarks, SystemOne, voice and remote
 * OCR are refused before any model request; only protected document
 * generation reaches a model. The alpha ships with them off.
 *
 * Read on every guarded request, so a change applies without a restart.
 */
export const GLOBAL_AI_GUIDANCE_ID = "__global_ai_guidance__";

/** Tightening-only firm lock for the alpha (no org-policy wire key exists yet): "1" forces boundaries on. */
export const AI_BOUNDARIES_FIRM_ENV = "LAWOSS_AI_BOUNDARIES_ENFORCED";
const ALPHA_DEFAULT = false;

export async function readAiBoundaries(config: ServerConfig): Promise<AiBoundaries> {
  if (process.env[AI_BOUNDARIES_FIRM_ENV]?.trim() === "1") return {enforced: true, locked: true, source: "firm"};
  const stored = (await readRuntimeOpencodeConfig(config, GLOBAL_AI_GUIDANCE_ID)).aiBoundaries;
  return stored ? {enforced: stored.enforced, locked: false, source: "user"} : {enforced: ALPHA_DEFAULT, locked: false, source: "default"};
}

export async function writeAiBoundaries(config: ServerConfig, enforced: boolean): Promise<AiBoundaries> {
  if ((await readAiBoundaries(config)).locked && !enforced)
    throw new ApiError(409, "ai_boundaries_locked", "Your firm keeps AI boundaries switched on.");
  await writeRuntimeOpencodeConfig(config, GLOBAL_AI_GUIDANCE_ID, current => ({...current, aiBoundaries: {enforced}}));
  return readAiBoundaries(config);
}
