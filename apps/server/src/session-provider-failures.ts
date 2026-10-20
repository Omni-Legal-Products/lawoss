import { dirname } from "node:path";
import type { SessionMessagesResponse2 } from "@opencode-ai/sdk/v2/client";
import { z } from "zod";
import { initializeSqlite } from "./runtime-db.js";
import { runtimeDbResource, withRuntimeDb } from "./runtime-db-lifecycle.js";
import type { ServerConfig } from "./types.js";
import { ensureDir } from "./utils.js";

export const providerFailureWitnessSchema = z.object({
  messageId: z.string().min(1).max(256), userMessageId: z.string().min(1).max(256),
  providerId: z.literal("openrouter"), modelId: z.string().max(200).regex(/^google\/gemini-3(?:[.-]|$)/),
  code: z.literal("gemini_thought_signature"),
}).strict();

const key = Symbol("session-provider-failures");
function store(config: ServerConfig) {
  return runtimeDbResource(config, key, async path => {
    await ensureDir(dirname(path));
    return initializeSqlite(path, db => {
      db.exec("CREATE TABLE IF NOT EXISTS session_provider_failures (workspace_id TEXT NOT NULL, session_id TEXT NOT NULL, message_id TEXT NOT NULL, code TEXT NOT NULL, PRIMARY KEY(workspace_id,session_id,message_id))");
      return db;
    });
  });
}

export function recordSessionProviderFailure(config: ServerConfig, workspaceId: string, sessionId: string, witness: z.infer<typeof providerFailureWitnessSchema>) {
  return withRuntimeDb(config, async () => (await store(config)).run(
    "INSERT INTO session_provider_failures VALUES (?,?,?,?) ON CONFLICT(workspace_id,session_id,message_id) DO UPDATE SET code=excluded.code",
    [workspaceId, sessionId, witness.messageId, witness.code],
  ));
}

/** A failed request is evidence of a failed turn only after its terminal idle snapshot.
 * Successful SDK retries and intermediate tool steps always take precedence. */
export function applySessionProviderFailures(config: ServerConfig, workspaceId: string, sessionId: string, messages: SessionMessagesResponse2, idle: boolean): Promise<SessionMessagesResponse2> {
  if (!idle) return Promise.resolve(messages);
  return withRuntimeDb(config, async () => {
    const rows = (await store(config)).all("SELECT message_id,code FROM session_provider_failures WHERE workspace_id=? AND session_id=?", [workspaceId, sessionId]);
    const failed = new Set(rows.filter(row => row.code === "gemini_thought_signature").map(row => row.message_id));
    return messages.map(message => {
      if (message.info.role !== "assistant" || message.info.providerID !== "openrouter" || !/^google\/gemini-3(?:[.-]|$)/.test(message.info.modelID) || message.info.summary || message.info.error || message.info.finish || !message.info.time.completed
        || message.parts.some(part => part.type === "text" && part.text.trim())) return message;
      return { ...message, info: { ...message.info, error: { name: "UnknownError", data: {
        message: failed.has(message.info.id)
          ? "The provider rejected this turn with a corrupted Gemini thought signature. The request did not complete. Send a new request after checking the provider connection."
          : "This model turn is incomplete: the engine became idle without a final answer or recorded error. Its cause is unknown. Send a new request to continue.",
      } } } };
    });
  });
}

export function deleteSessionProviderFailures(config: ServerConfig, workspaceId: string, sessionId: string) {
  return withRuntimeDb(config, async () => (await store(config)).run("DELETE FROM session_provider_failures WHERE workspace_id=? AND session_id=?", [workspaceId, sessionId]));
}
