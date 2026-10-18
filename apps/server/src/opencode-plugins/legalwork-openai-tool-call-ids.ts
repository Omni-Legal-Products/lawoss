import { createHash } from "node:crypto";

// LiteLLM carries Gemini thought signatures in tool IDs. Replaying those IDs
// after switching to OpenAI exceeds its 64-character limit. Rewrite only the
// wire payload, preserving saved history and signatures needed by Gemini.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestPath(input: Parameters<typeof fetch>[0]): string {
  try { return new URL(input instanceof Request ? input.url : String(input)).pathname; }
  catch { return ""; }
}

function normalizeBody(body: string, path: string): string | null {
  let parsed: unknown;
  try { parsed = JSON.parse(body); }
  catch { return null; }
  if (!isRecord(parsed)) return null;
  const references: { item: Record<string, unknown>; key: string; id: string }[] = [];
  const add = (item: Record<string, unknown>, key: string) => {
    const id = item[key];
    if (typeof id === "string") references.push({ item, key, id });
  };
  if (/\/responses\/?$/.test(path) && Array.isArray(parsed.input)) {
    for (const item of parsed.input) {
      if (isRecord(item) && ["function_call", "function_call_output", "custom_tool_call", "custom_tool_call_output"].includes(String(item.type))) add(item, "call_id");
    }
  } else if (/\/chat\/completions\/?$/.test(path) && typeof parsed.model === "string" && /(?:^|[\s/])(?:gpt-|chatgpt-|o[1-9](?:-|$))/i.test(parsed.model) && Array.isArray(parsed.messages)) {
    for (const message of parsed.messages) {
      if (!isRecord(message)) continue;
      if (message.role === "tool") add(message, "tool_call_id");
      if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) if (isRecord(call)) add(call, "id");
      }
    }
  }
  const longIds = [...new Set(references.filter(ref => ref.id.length > 64).map(ref => ref.id))].sort();
  if (!longIds.length) return null;
  const used = new Set(references.filter(ref => ref.id.length <= 64).map(ref => ref.id));
  const replacements = new Map<string, string>();
  for (const id of longIds) {
    let salt = 0;
    let compact: string;
    do {
      const hash = createHash("sha256").update(id);
      if (salt) hash.update(`\0${salt}`);
      compact = `call_lw_${hash.digest("hex").slice(0, 56)}`;
      salt += 1;
    } while (used.has(compact));
    used.add(compact);
    replacements.set(id, compact);
  }
  for (const ref of references) {
    const compact = replacements.get(ref.id);
    if (compact) ref.item[ref.key] = compact;
  }
  return JSON.stringify(parsed);
}

let installed = false;

// Keep helpers private: OpenCode treats every export as a plugin factory.
export const LegalWorkOpenAIToolCallIds = async () => {
  if (!installed) {
    installed = true;
    const base = globalThis.fetch;
    const patched = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const path = requestPath(input);
      if (!/\/(?:responses|chat\/completions)\/?$/.test(path)) return base(input, init);
      const body = typeof init?.body === "string" ? init.body
        : init?.body == null && input instanceof Request && input.method === "POST" ? await input.clone().text() : null;
      if (body === null) return base(input, init);
      const normalized = normalizeBody(body, path);
      if (normalized === null) return base(input, init);
      // Preserve Request-carried headers/auth and the caller's abort signal.
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.delete("content-length");
      if (input instanceof Request) return base(new Request(input, { ...init, headers, body: normalized }));
      return base(input, { ...init, headers, body: normalized });
    };
    globalThis.fetch = Object.assign(patched, base);
  }
  return {};
};
