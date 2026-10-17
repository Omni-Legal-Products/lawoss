import { z } from "zod";

// Keep every prompt-bearing field, including tool-call IDs, schema ordering,
// synthetic reminders and assistant/tool messages. Transport metadata is outside
// this view. Do not sort tools/messages or normalize their text.
export const CacheRequestSchema = z.object({
  model: z.string(),
  messages: z.array(z.object({ role: z.string() }).passthrough()),
  tools: z.array(z.unknown()).optional(),
  tool_choice: z.unknown().optional(),
}).passthrough();
export type CacheRequest = z.infer<typeof CacheRequestSchema>;

function firstDifference(before: unknown, after: unknown, path: string): string | null {
  if (Object.is(before, after)) return null;
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) return `${path}.length`;
    for (let i = 0; i < before.length; i++) {
      const difference = firstDifference(before[i], after[i], `${path}[${i}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (before && after && typeof before === "object" && typeof after === "object") {
    const keys = Object.keys(before);
    if (JSON.stringify(keys) !== JSON.stringify(Object.keys(after))) return `${path}.keys`;
    for (const key of keys) {
      const difference = firstDifference(Reflect.get(before, key), Reflect.get(after, key), `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return path;
}

/** One conversation/agent/model epoch. Reset only at an explicit caller boundary. */
export function assertCachePrefix(before: CacheRequest, after: CacheRequest, context: string): void {
  for (const field of ["model", "tools", "tool_choice", "functions", "function_call", "response_format"]) {
    const difference = firstDifference(Reflect.get(before, field), Reflect.get(after, field), field);
    if (difference) throw new Error(`${context}: prompt cache prefix changed at ${difference}`);
  }
  if (after.messages.length < before.messages.length) throw new Error(`${context}: prompt cache prefix shortened at messages.length`);
  for (let i = 0; i < before.messages.length; i++) {
    const difference = firstDifference(before.messages[i], after.messages[i], `messages[${i}]`);
    if (difference) throw new Error(`${context}: prompt cache prefix changed at ${difference}`);
  }
}
