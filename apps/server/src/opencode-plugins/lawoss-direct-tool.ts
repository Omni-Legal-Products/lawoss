import type { Info } from "@opencode/plugin/promise/tool";

/**
 * LAWOSS #472: engine 2.1.4 offers a plugin tool to the model by name only with `codemode: false`
 * (`packages/core/src/tool.ts` snapshot); otherwise it exists only inside Code Mode `execute`, and a direct call ends
 * with "No tool named … is currently available". The LAWOSS tools that the fixed system texts tell the model to call
 * by name are offered directly, next to the engine's own read, write and edit, which the model would otherwise use.
 */
export function directTool(tool: Info): Info {
  const permission = tool.options?.permission, namespace = tool.options?.namespace;
  // A direct tool is never pinned in the Code Mode catalog.
  return { ...tool, options: { codemode: false, ...permission === undefined ? {} : { permission }, ...namespace === undefined ? {} : { namespace } } };
}
