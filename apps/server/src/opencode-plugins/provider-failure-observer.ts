import type { Plugin } from "@opencode/plugin";
import { z } from "zod";
import { resolveWorkspaceId, serverUrl, workspaceToolHeaders } from "./office-plugin-shared.js";
import { wikiAgentSecret } from "./wiki-agent-secret.js";

/**
 * LAWOSS: a bounded witness for one known provider failure (Gemini 3 through OpenRouter rejecting a
 * corrupted thought signature). The engine's own HTTP hooks bind the request to its native assistant
 * and user message before dispatch; the response body is forwarded byte for byte and never retained.
 */
const MAX_BYTES = 32768;
const MAX_PUBLICATIONS = 8;
const GEMINI_3 = /^google\/gemini-3(?:[.-]|$)/;

type Binding = { sessionID: string; messageId: string; userMessageId: string; providerId: string; modelId: string; directory: string };
type Owner = { closed: boolean; stop: AbortController; jobs: Set<Promise<void>> };

const historySchema = z.array(z.object({
  type: z.string(), id: z.string(),
  model: z.object({ id: z.string(), providerID: z.string() }).optional(),
  time: z.object({ completed: z.unknown().optional() }).passthrough().optional(),
}).passthrough());

export function signatureRejection(text: string): boolean {
  try {
    const error = z.object({ error: z.object({ message: z.string().optional(), metadata: z.object({ raw: z.string().optional() }).optional() }) }).parse(JSON.parse(text)).error;
    if (error.message?.includes("Corrupted thought signature.")) return true;
    if (error.metadata?.raw) return z.object({ error: z.object({ message: z.literal("Corrupted thought signature.") }) }).safeParse(JSON.parse(error.metadata.raw)).success;
  } catch { /* Unknown provider responses remain unknown. */ }
  return false;
}

/** The running assistant after the latest user message, from the same model; otherwise unknown. */
export function bindTurn(history: unknown, model: { id: string; providerID: string }): { messageId: string; userMessageId: string } | null {
  const parsed = historySchema.safeParse(history);
  if (!parsed.success) return null;
  const messages = parsed.data;
  let user = -1;
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index]!.type === "user") { user = index; break; }
  if (user < 0) return null;
  const assistant = messages.slice(user + 1).filter(message => message.type === "assistant").at(-1);
  if (!assistant || assistant.time?.completed !== undefined || assistant.model?.id !== model.id || assistant.model.providerID !== model.providerID) return null;
  return { messageId: assistant.id, userMessageId: messages[user]!.id };
}

function enqueue(owner: Owner, job: (signal: AbortSignal) => Promise<void>) {
  if (owner.closed || owner.jobs.size >= MAX_PUBLICATIONS) return;
  const running = Promise.resolve().then(() => job(owner.stop.signal)).catch(() => {}).finally(() => { owner.jobs.delete(running); });
  owner.jobs.add(running);
}

async function publish(binding: Binding, signal: AbortSignal) {
  signal.throwIfAborted();
  const context = { sessionID: binding.sessionID, directory: binding.directory, abort: signal };
  const workspace = await resolveWorkspaceId(context, { requireDirectory: true });
  const response = await fetch(`${serverUrl()}/workspace/${encodeURIComponent(workspace)}/sessions/${encodeURIComponent(binding.sessionID)}/provider-failure`, {
    method: "POST", headers: { ...await workspaceToolHeaders(context), "content-type": "application/json" }, signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    body: JSON.stringify({ messageId: binding.messageId, userMessageId: binding.userMessageId, providerId: binding.providerId, modelId: binding.modelId, code: "gemini_thought_signature" }),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error("Provider observation was not accepted.");
}

/** Forward every byte with backpressure; diagnostics have their own bounded owner and never hold EOF. */
function observed(response: Response, onMatch: () => void): Response {
  if (!response.body) return response;
  const decoder = new TextDecoder();
  let text = "", bytes = 0;
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      bytes += chunk.byteLength;
      if (bytes <= MAX_BYTES) text += decoder.decode(chunk, { stream: true }); else text = "";
    },
    flush() {
      if (bytes <= MAX_BYTES && signatureRejection(text + decoder.decode())) onMatch();
      text = "";
    },
  }));
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export async function registerProviderFailureObserver(ctx: Plugin.Context): Promise<() => Promise<void>> {
  const owner: Owner = { closed: false, stop: new AbortController(), jobs: new Set() };
  const bound = new WeakMap<Request, Binding>();
  const before = await ctx.session.hook("http.request", async (event) => {
    if (owner.closed || event.kind !== "primary" || event.model.providerID !== "openrouter" || !GEMINI_3.test(event.model.id) || !serverUrl() || !wikiAgentSecret()) return;
    try {
      const session = await ctx.session.get({ sessionID: event.sessionID });
      const turn = bindTurn(await ctx.session.context({ sessionID: event.sessionID }), event.model);
      if (!turn || owner.closed) return;
      bound.set(event.request, { ...turn, sessionID: event.sessionID, providerId: event.model.providerID, modelId: event.model.id, directory: session.location.directory });
    } catch { /* Missing ownership never guesses a message or modifies the request. */ }
  }, { providerID: "openrouter" });
  const after = await ctx.session.hook("http.response", (event) => {
    const binding = bound.get(event.request);
    if (!binding) return;
    bound.delete(event.request);
    if (owner.closed || event.response.status !== 400) return;
    event.response = observed(event.response, () => enqueue(owner, signal => publish(binding, signal)));
  }, { providerID: "openrouter" });
  return async () => {
    owner.closed = true;
    owner.stop.abort();
    await Promise.all([before.dispose(), after.dispose()]);
    await Promise.all([...owner.jobs]);
  };
}
