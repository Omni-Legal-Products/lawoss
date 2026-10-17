import { expect, test } from "bun:test";
import { assertCachePrefix, CacheRequestSchema } from "./prompt-cache.test-support.js";

const request = CacheRequestSchema.parse({ model: "fixture", tools: [
  { type: "function", function: { name: "read", parameters: { type: "object" } } },
  { type: "function", function: { name: "clock", parameters: { type: "object" } } },
], messages: [
  { role: "system", content: "Fixed instructions" },
  { role: "user", content: "Question" },
  { role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "read", arguments: "{}" } }] },
  { role: "tool", tool_call_id: "call_1", content: "Saved result" },
] });

test("cache contract allows only appended history and transport metadata", () => {
  const next = { ...request, user: "different telemetry", stream: true, messages: [...request.messages, { role: "user", content: "Continue" }] };
  expect(() => assertCachePrefix(request, next, "parent step 2")).not.toThrow();
});

test("cache contract rejects a live system timestamp, reordered tools and rewritten history", () => {
  const timestamp = structuredClone(request);
  timestamp.messages[0].content = "Fixed instructions\nCurrent time: 2026-10-12T12:00:01Z";
  expect(() => assertCachePrefix(request, timestamp, "parent step 2")).toThrow("messages[0].content");
  expect(() => assertCachePrefix(request, { ...request, tools: [...(request.tools ?? [])].reverse() }, "parent step 2")).toThrow("tools[0].function.name");
  const rewritten = structuredClone(request);
  rewritten.messages[3].content = "Recomputed result";
  expect(() => assertCachePrefix(request, rewritten, "parent step 2")).toThrow("messages[3].content");
  rewritten.messages[3] = { ...request.messages[3], tool_call_id: "call_2" };
  expect(() => assertCachePrefix(request, rewritten, "parent step 2")).toThrow("messages[3].tool_call_id");
  expect(() => assertCachePrefix(request, { ...request, messages: request.messages.slice(0, 2) }, "parent step 2")).toThrow("messages.length");
  expect(() => assertCachePrefix(request, { ...request, model: "other" }, "parent step 2")).toThrow("model");
});
