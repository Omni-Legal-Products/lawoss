import { writeRuntimeOpencodeConfig } from "../../runtime-opencode-config-store.js";
import type { ServerConfig } from "../../types.js";
import { GLOBAL_AI_GUIDANCE_ID, writeAiBoundaries } from "../ai-boundaries.js";

/**
 * Tests of #168's denial switch „AI hranice" on explicitly; the alpha default is off.
 * Configs without `configPath` share the preload's temporary profile DB, so call the
 * returned restore in cleanup to leave the default for later tests in the same process.
 */
export async function enforceAiBoundaries(config: ServerConfig): Promise<() => Promise<void>> {
  await writeAiBoundaries(config, true);
  return async () => {
    await writeRuntimeOpencodeConfig(config, GLOBAL_AI_GUIDANCE_ID, ({aiBoundaries: _removed, ...rest}) => rest);
  };
}
