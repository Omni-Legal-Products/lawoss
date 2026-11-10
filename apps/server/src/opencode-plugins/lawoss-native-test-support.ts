import type { Plugin } from "@opencode/plugin";
import type { OpenCodeContext } from "./office-plugin-shared.js";
import { nativePluginTools } from "./native-plugin-test-support.js";

/**
 * LAWOSS: a LAWOSS engine plugin under the real Plugin.define setup (upstream native test runtime), plus the
 * fixed system text it adds to a turn. No engine and no model.
 */
export async function lawossNativePlugin(plugin: Plugin.Plugin, initial: OpenCodeContext = {}) {
  const native = await nativePluginTools(plugin, initial);
  return { ...native, async system(sessionID = initial.sessionID ?? "ses_test"): Promise<string[]> {
    const event = { sessionID, agent: "legalwork", system: [] as Array<{ type: string; text: string }>, messages: [], options: {}, tools: {} };
    await native.runtime.hook("session", "context", event);
    return event.system.map((part) => part.text);
  } };
}
