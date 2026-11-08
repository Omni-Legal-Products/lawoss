import { Plugin } from "@opencode/plugin";
import { z } from "zod";
import { nativeEvents } from "./native-events.js";
import { toolProgressGuard } from "./tool-progress-guard.js";

export default Plugin.define({ id: "legalwork.tool-recovery", async setup(ctx) {
  const pending = new Map<string, { reason: string; messageID: string }>();
  const recovery = toolProgressGuard(async (sessionID, reason, messageID) => { pending.set(sessionID, { reason, messageID }); });
  await ctx.session.hook("prompt", event => { recovery.reset(event.sessionID); pending.delete(event.sessionID); });
  await ctx.session.hook("context", async event => {
    // Code Mode hides nested tools from the model-facing catalog. Read the
    // registered definitions so nested failures get the same guidance.
    for (const tool of await ctx.tool.list()) {
      const schema = z.record(z.string(), z.unknown()).safeParse(tool.input);
      await recovery.definition({ toolID: tool.id }, { description: tool.description, ...(schema.success ? { jsonSchema: schema.data } : {}) });
    }
    // Amend only the latest matching result, leaving the cached prefix intact.
    for (let index = event.messages.length - 1; index >= 0; index--) {
      const message = event.messages[index];
      const content = [...message.content];
      for (let partIndex = content.length - 1; partIndex >= 0; partIndex--) {
        const part = content[partIndex];
        if (part.type !== "tool-result") continue;
        const guidance = recovery.guidance(event.sessionID, part.name === "execute" ? undefined : part.id);
        if (!guidance) continue;
        if (part.result.type === "error") content[partIndex] = { ...part, result: { type: "error", value: guidance } };
        else if (part.name !== "execute") continue;
        // Nested Code Mode errors arrive inside the outer execute result.
        else if (part.result.type === "content") content[partIndex] = { ...part, result: { type: "content", value: [...part.result.value, { type: "text", text: guidance }] } };
        else content[partIndex] = { ...part, result: { type: "text", value: `${typeof part.result.value === "string" ? part.result.value : JSON.stringify(part.result.value)}\n\n${guidance}` } };
        event.messages[index] = { ...message, content };
        return;
      }
    }
  });
  await ctx.tool.hook("execute.after", async event => {
    if (event.tool === "execute" && event.status === "completed") return;
    await recovery.observe({ id: event.id, sessionID: event.sessionID, messageID: event.messageID, tool: event.tool,
      input: event.input, ...(event.status === "error" ? { error: event.error.message } : {}) });
  });
  // Interrupt only after the failure is persisted, outside the tool's own
  // execution fiber. Awaiting an interrupt in execute.after deadlocks it.
  return nativeEvents(ctx, async event => {
    if (event.type === "session.tool.failed" || event.type === "session.tool.success") {
      const stop = pending.get(event.data.sessionID);
      if (!stop) return;
      pending.delete(event.data.sessionID);
      const session = await ctx.session.get({ sessionID: event.data.sessionID });
      const previous = z.record(z.string(), z.json()).safeParse(session.metadata?.legalworkToolStops);
      // Session metadata is durable without admitting another model turn. A
      // synthetic inbox item either waits until the next turn or resumes work.
      await ctx.session.update({ sessionID: event.data.sessionID, metadata: { ...session.metadata,
        legalworkToolStops: { ...(previous.success ? previous.data : {}), [stop.messageID]: { reason: "repeated-invalid-tool-calls" } },
      } });
      await ctx.session.interrupt({ sessionID: event.data.sessionID });
    }
    if (event.type === "session.idle" || event.type === "session.deleted") {
      recovery.reset(event.data.sessionID); pending.delete(event.data.sessionID);
    }
  });
} });
