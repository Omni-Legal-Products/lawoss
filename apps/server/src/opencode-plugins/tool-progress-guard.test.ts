import { expect, test } from "bun:test";
import type { ToolDefinition } from "./tool-validation-feedback.js";
import { toolProgressGuard, type ToolAttempt } from "./tool-progress-guard.js";
import recoveryPlugin from "./legalwork-tool-recovery.js";
import { nativePluginTestRuntime } from "./native-plugin-test-support.js";

function failure(index: number, input: unknown = { query: "" }, messageID = `message-${index}`): ToolAttempt {
  return { id: `part-${index}`, sessionID: "child", messageID, tool: "fixture", input,
    error: '[{"code":"too_small","path":["query"],"message":"Invalid input"}]' };
}
const definition = { description: 'Supply a non-empty query, for example {"query":"invoice"}.', jsonSchema: { type: "object", properties: { query: { type: "string", minLength: 1 } }, required: ["query"] } } satisfies ToolDefinition;
function setup() {
  const stopped: string[] = [];
  const guard = toolProgressGuard(async (_session, reason) => { stopped.push(reason); });
  void guard.definition({ toolID: "fixture" }, definition);
  const deliver = async (index: number, input: unknown = { query: "" }, messageID = `message-${index}`) => {
    const next = failure(index, input, messageID);
    await guard.observe(next);
    return guard.guidance(next.sessionID, next.id);
  };
  return { ...guard, stopped, deliver };
}
test("gives guidance immediately and allows three recovery steps after the warning", async () => {
  const guard = setup();
  expect(await guard.deliver(1)).toContain('"query":"invoice"');
  await guard.deliver(2);
  expect(await guard.deliver(3)).toContain("three further assistant steps");
  expect(guard.stopped).toHaveLength(0);
  expect(await guard.deliver(4)).toContain("two further assistant steps");
  expect(await guard.deliver(5)).toContain("Final warning: one retry remains.");
  expect(guard.stopped).toHaveLength(0);
  await guard.deliver(6); await guard.deliver(7);
  expect(guard.stopped).toHaveLength(1);
  expect(guard.stopped[0]).toContain("after correction guidance");
});
test("never stops before correction guidance reaches a model request", async () => {
  const guard = setup();
  for (let index = 0; index < 12; index++) await guard.observe(failure(index));
  expect(guard.stopped).toHaveLength(0);
});
test("duplicate events and parallel calls cannot exhaust recovery steps", async () => {
  const guard = setup();
  await guard.deliver(1); await guard.deliver(2); await guard.deliver(3);
  await guard.observe(failure(3));
  for (let index = 4; index < 12; index++) await guard.observe(failure(index, { query: "" }, "one-parallel-step"));
  expect(guard.stopped).toHaveLength(0);
  await guard.deliver(12); expect(guard.stopped).toHaveLength(0);
  await guard.deliver(13); expect(guard.stopped).toHaveLength(1);
});
test("corrected arguments, successful progress and new user turns reset recovery", async () => {
  const guard = setup();
  await guard.deliver(1); await guard.deliver(2); await guard.deliver(3); await guard.deliver(4);
  await guard.deliver(5, { query: "corrected" });
  await guard.deliver(6); await guard.deliver(7);
  await guard.observe({ ...failure(8), error: undefined });
  await guard.deliver(9); await guard.deliver(10);
  guard.reset("child"); await guard.deliver(11);
  expect(guard.stopped).toHaveLength(0);
});
test("ignores other tools and service errors with valid arguments", async () => {
  const guard = setup();
  for (let index = 0; index < 8; index++) {
    await guard.observe({ ...failure(index, { query: "valid" }), error: "HTTP 503: temporarily unavailable" });
    await guard.observe({ ...failure(index), tool: "unknown_tool" });
  }
  expect(guard.stopped).toHaveLength(0);
});
for (const nested of [false, true]) test(`native ${nested ? "Code Mode" : "direct"} stops persist the reason after the failed result`, async () => {
  const runtime = nativePluginTestRuntime("/project");
  runtime.tools.set("fixture", { name: "fixture", description: definition.description, input: definition.jsonSchema, execute: async () => ({ content: "unused" }) });
  await runtime.start(recoveryPlugin);
  const context = async (index: number) => {
    const event = { sessionID: "child", messages: [{ role: "tool", content: [{ type: "tool-result", id: nested ? `execute-${index}` : `part-${index}`, name: nested ? "execute" : "fixture", result: { type: nested ? "text" : "error", value: "Invalid input" } }] }] };
    const earlier = { role: "tool", content: [{ type: "tool-result", id: "old-result", name: "execute", result: { type: "text", value: "Earlier work stays cached" } }] };
    event.messages.unshift(earlier);
    await runtime.hook("session", "context", event);
    expect(event.messages[0]).toEqual(earlier);
    expect(event.messages[0].content[0].result.value).toBe("Earlier work stays cached");
    return event.messages[1].content[0].result.value;
  };
  try {
    await context(0);
    for (let index = 1; index <= 6; index++) {
      const attempt = failure(index);
      await runtime.hook("tool", "execute.after", { ...attempt, status: "error", error: { message: attempt.error } });
      if (nested) await runtime.hook("tool", "execute.after", { ...attempt, tool: "execute", status: "completed", result: { content: "nested failure" } });
      expect(runtime.interrupts).toHaveLength(0);
      if (index === 5) expect(await context(index)).toContain("Final warning: one retry remains.");
      else await context(index);
      await runtime.event({ type: nested ? "session.tool.success" : "session.tool.failed", data: { sessionID: "child", id: attempt.id } });
    }
    expect(runtime.interrupts).toEqual(["child"]);
    expect(runtime.sessions.get("child")?.metadata).toEqual({ legalworkToolStops: { "message-6": { reason: "repeated-invalid-tool-calls" } } });
    expect(runtime.synthetics).toEqual([]);
    await runtime.hook("session", "prompt", { sessionID: "child", messageID: "follow-up", prompt: { text: "Try another approach" } });
    await runtime.hook("tool", "execute.after", { ...failure(7), status: "error", error: { message: failure(7).error } });
    expect(await context(7)).toContain("Correct these arguments before retrying.");
  } finally { await runtime.close(); }
});
