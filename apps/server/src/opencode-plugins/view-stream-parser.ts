import { serverSentEvents } from "@legalwork/types/sync-events";
import type { ViewGenerationChunk } from "../views/generation-stream.js";

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }

/** Provider SSE compatibility for engines that discard tool-input-delta. Bytes pass through untouched. */
export function viewStreamParser(emit: (chunk: ViewGenerationChunk) => void) {
  const calls = new Map<string, ViewGenerationChunk>();
  const start = (key: string, id: unknown, name: unknown, raw = "") => {
    if (typeof id !== "string" || (name !== "view_create" && name !== "view_update") || calls.size >= 16 || raw.length > 200_000) return;
    const chunk = { callId: id, tool: name, raw } satisfies ViewGenerationChunk;
    calls.set(key, chunk);
    emit(chunk);
  };
  const append = (key: string, delta: unknown) => {
    const call = calls.get(key);
    if (!call || typeof delta !== "string") return;
    // The model may still finish and save larger definitions; previews are bounded.
    if (call.raw.length + delta.length > 200_000) { calls.delete(key); return; }
    call.raw += delta;
    emit({ ...call });
  };
  return serverSentEvents(data => {
    let event: unknown;
    try { event = JSON.parse(data); } catch { return; }
    if (!record(event)) return;
    // OpenAI Responses (including the engine's ChatGPT authentication provider).
    if (event.type === "response.output_item.added" && record(event.item) && event.item.type === "function_call") {
      start(String(event.item.id), event.item.call_id, event.item.name, typeof event.item.arguments === "string" ? event.item.arguments : "");
    } else if (event.type === "response.function_call_arguments.delta") {
      append(String(event.item_id), event.delta);
    // Anthropic Messages.
    } else if (event.type === "content_block_start" && record(event.content_block) && event.content_block.type === "tool_use") {
      start(String(event.index), event.content_block.id, event.content_block.name);
    } else if (event.type === "content_block_delta" && record(event.delta) && event.delta.type === "input_json_delta") {
      append(String(event.index), event.delta.partial_json);
    // OpenAI Chat Completions and compatible providers. Parallel tool indexes are independent.
    } else if (Array.isArray(event.choices)) {
      for (const choice of event.choices) {
        if (!record(choice) || !record(choice.delta) || !Array.isArray(choice.delta.tool_calls)) continue;
        for (const tool of choice.delta.tool_calls) {
          if (!record(tool) || !record(tool.function)) continue;
          const key = `${choice.index}:${tool.index}`;
          if (tool.id) start(key, tool.id, tool.function.name);
          append(key, tool.function.arguments);
        }
      }
    }
  });
}
