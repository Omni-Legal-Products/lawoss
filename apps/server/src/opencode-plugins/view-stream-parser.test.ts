import { expect, test } from "bun:test";
import { viewStreamParser } from "./view-stream-parser.js";
import type { ViewGenerationChunk } from "../views/generation-stream.js";

function parser() {
  const chunks: ViewGenerationChunk[] = [];
  const feed = viewStreamParser(chunk => chunks.push({ ...chunk }));
  return { chunks, send: (event: unknown) => {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const char of frame) feed(char);
  } };
}
test("Responses streams real partial JSON, including escaped newlines, in isolated parallel calls", () => {
  const { chunks, send } = parser();
  send({ type: "response.output_item.added", item: { id: "i1", call_id: "c1", type: "function_call", name: "view_create", arguments: "" } });
  send({ type: "response.output_item.added", item: { id: "i2", call_id: "c2", type: "function_call", name: "view_update", arguments: "" } });
  send({ type: "response.function_call_arguments.delta", item_id: "i1", delta: '{"input":{"program":"root = Stack(' });
  expect(chunks.at(-1)?.raw).toBe('{"input":{"program":"root = Stack(');
  send({ type: "response.function_call_arguments.delta", item_id: "i2", delta: '{"input":{"title":"Second"' });
  send({ type: "response.function_call_arguments.delta", item_id: "i1", delta: ')\\n"}}' });
  expect(chunks.at(-1)).toEqual({ callId: "c1", tool: "view_create", raw: '{"input":{"program":"root = Stack()\\n"}}' });
  expect(chunks.filter(chunk => chunk.callId === "c2").at(-1)?.raw).toBe('{"input":{"title":"Second"');
});
test("Anthropic and Chat Completions formats preserve tool argument chunks", () => {
  const { chunks, send } = parser();
  send({ type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "anthropic", name: "view_create" } });
  send({ type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"input":' } });
  send({ choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: "chat", function: { name: "view_update", arguments: '{"input":' } }] } }] });
  send({ choices: [{ index: 0, delta: { tool_calls: [{ index: 1, function: { arguments: '{"title":"Live"}}' } }] } }] });
  expect(chunks.find(chunk => chunk.callId === "anthropic" && chunk.raw)).toMatchObject({ raw: '{"input":' });
  expect(chunks.at(-1)).toEqual({ callId: "chat", tool: "view_update", raw: '{"input":{"title":"Live"}}' });
});
test("ordinary tools, text and oversized previews are never forwarded", () => {
  const { chunks, send } = parser();
  send({ type: "response.output_item.added", item: { id: "other", call_id: "secret", type: "function_call", name: "read", arguments: "" } });
  send({ type: "response.function_call_arguments.delta", item_id: "other", delta: "private data" });
  expect(chunks).toEqual([]);
  send({ type: "response.output_item.added", item: { id: "view", call_id: "bounded", type: "function_call", name: "view_create", arguments: "" } });
  send({ type: "response.function_call_arguments.delta", item_id: "view", delta: "x".repeat(200_001) });
  expect(chunks).toHaveLength(1);
});
