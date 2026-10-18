import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { SavedConversations } from "./app-state-reminders.js";
import { resolveWorkspaceId, serverUrl, workspaceToolHeaders } from "./office-plugin-shared.js";

const HEADER = "x-lawoss-provider-observation";
const MAX_BYTES = 32768;
const pending = new Map<string, { at: number; publish: () => Promise<void> }>();
let installed = false;
const messagesSchema = z.array(z.object({ info: z.object({ id: z.string(), sessionID: z.string(), role: z.string(), parentID: z.string().optional(), providerID: z.string().optional(), modelID: z.string().optional(), time: z.object({ completed: z.number().optional() }).optional() }) }));

function signatureRejection(text: string): boolean {
  try {
    const error = z.object({ error: z.object({ message: z.string().optional(), metadata: z.object({ raw: z.string().optional() }).optional() }) }).parse(JSON.parse(text)).error;
    if (error.message?.includes("Corrupted thought signature.")) return true;
    if (error.metadata?.raw) return z.object({ error: z.object({ message: z.literal("Corrupted thought signature.") }) }).safeParse(JSON.parse(error.metadata.raw)).success;
  } catch { /* Unknown provider responses remain unknown. */ }
  return false;
}

function install() {
  if (installed) return;
  installed = true;
  const base = globalThis.fetch;
  const patched = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const id = headers.get(HEADER);
    if (!id) return base(input, init);
    headers.delete(HEADER);
    const source = pending.get(id);
    const response = await base(input, { ...init, headers });
    if (!source || source.at < Date.now() - 600_000 || response.status !== 400 || !response.body) return response;
    // Tee-free observation: forward every byte and apply backpressure; never retain a raw body.
    const decoder = new TextDecoder();
    let text = "", bytes = 0;
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        bytes += chunk.byteLength;
        if (bytes <= MAX_BYTES) text += decoder.decode(chunk, { stream: true }); else text = "";
      },
      async flush() {
        if (bytes <= MAX_BYTES && signatureRejection(text + decoder.decode())) {
          try { await source.publish(); } catch { /* Observation cannot change provider transport behavior. */ }
        }
        text = "";
      },
    }));
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  globalThis.fetch = Object.assign(patched, base);
}

/** Correlation comes from the engine's current assistant before dispatch. Local nonce is never sent upstream. */
export function providerFailureObserver(initial: SavedConversations) {
  return async (input: { sessionID: string; model: { providerID: string; id: string; api?: { id?: string; npm?: string } }; message: { id: string } }, output: { headers: Record<string, string> }) => {
    const modelId = input.model.api?.id ?? input.model.id;
    if (input.model.providerID !== "openrouter" || !/^google\/gemini-3(?:[.-]|$)/.test(modelId) || !initial.directory || !initial.client?.session || !serverUrl() || !process.env.LEGALWORK_WIKI_AGENT_TOKEN) return;
    try {
      const query = { directory: initial.directory, limit: 1 };
      const data = (await initial.client.session.messages({ path: { id: input.sessionID }, query })).data;
      const parsed = messagesSchema.safeParse(data);
      const last = parsed.success ? parsed.data.at(-1)?.info : undefined;
      if (!last || last.role !== "assistant" || last.sessionID !== input.sessionID || last.parentID !== input.message.id || last.providerID !== input.model.providerID || last.modelID !== input.model.id || last.time?.completed) return;
      install();
      const now = Date.now();
      for (const [id, entry] of pending) if (entry.at < now - 600_000) pending.delete(id);
      if (pending.size >= 256) return;
      const id = randomBytes(16).toString("hex");
      const context = { sessionID: input.sessionID, directory: initial.directory };
      pending.set(id, { at: now, async publish() {
        const workspace = await resolveWorkspaceId(context, { requireDirectory: true });
        await fetch(`${serverUrl()}/workspace/${encodeURIComponent(workspace)}/sessions/${encodeURIComponent(input.sessionID)}/provider-failure`, {
          method: "POST", headers: { ...await workspaceToolHeaders(context), "content-type": "application/json" }, signal: AbortSignal.timeout(5000),
          body: JSON.stringify({ messageId: last.id, userMessageId: input.message.id, providerId: input.model.providerID, modelId, code: "gemini_thought_signature" }),
        });
      } });
      output.headers[HEADER] = id;
    } catch { /* Missing ownership never guesses a message or modifies the request. */ }
  };
}
