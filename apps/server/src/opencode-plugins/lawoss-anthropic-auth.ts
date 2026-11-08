/**
 * LAWOSS: prihlásenie Anthropic pre engine OpenCode 2 (rozhodnutie MČ 8. 11. 2026: port, nie vypustenie).
 *
 * Nahrádza npm balík `opencode-anthropic-auth` 0.0.13 (MIT, © 2025 SST), ktorý je plugin API v1: engine 2.1.4 ho
 * nenačíta (`core/src/plugin/module.ts` žiada default export s `id` a `setup`/`effect`) a cieľ bez absolútnej cesty
 * by pri štarte sťahoval z npm (`npm.add`). Tento plugin je pribalený ako ostatné pluginy LAWOSS a ponúka to isté:
 *
 * - „Claude Pro/Max“: OAuth predplatného (claude.ai, PKCE, kód sa vkladá ručne). Engine sám dá prístupový token
 *   do `Authorization: Bearer` (`model-resolver.ts`, `authToken` balíka anthropic) a pred vypršaním ho obnoví cez
 *   `refresh` tejto metódy (`integration.ts`, `connection.resolve`). Id metódy je `oauth`: pod týmto id engine
 *   prenáša prihlásenie Anthropic z `auth.json` v1 (migrácia `import_legacy_credentials`), takže obnova funguje aj
 *   pre prenesené prihlásenie.
 * - „Create an API Key“: OAuth konzoly, ktorým sa vytvorí API kľúč. Engine 2 dovoľuje metóde OAuth vrátiť len
 *   záznam OAuth, preto vytvorený kľúč nesie záznam OAuth tejto metódy (bez obnovy) a háčik požiadavky ho pošle
 *   ako `x-api-key`, ako pri ručne zadanom kľúči.
 * - Ručné zadanie API kľúča ponúka engine sám (metóda `key` z katalógu models.dev).
 *
 * Pri predplatnom upraví požiadavku ako pôvodný balík: hlavičky `anthropic-beta` (OAuth, prekladané uvažovanie),
 * `user-agent` klienta Claude Code, bez `x-api-key`, `?beta=true` pri `/v1/messages`, úvodný systémový text Claude
 * Code, značka „OpenCode“ v systémovom texte, predpona `mcp_` mien nástrojov v požiadavke a jej odstránenie
 * v odpovedi; ceny modelov Anthropic sú nulové. Oproti pôvodnému balíku: cesty (`.opencode/…`) v systémovom
 * texte ostávajú, `tool_choice` dostane tú istú predponu ako nástroje a odpoveď sa upravuje po riadkoch SSE.
 * Prihlásenie API kľúčom sa nemení. Plugin nič nesťahuje a nepoužíva žiadny iný balík.
 */
// OpenCode 2 načíta `default` export (`Plugin.define`).
import { Credential, Integration, Plugin } from "@opencode/plugin";

const PROVIDER = "anthropic";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const CREATE_KEY_URL = "https://api.anthropic.com/api/oauth/claude_cli/create_api_key";
const SCOPE = "org:create_api_key user:profile user:inference";
/** Pod týmto id engine prenáša OAuth Anthropic z v1; nové prihlásenie predplatného dostane to isté. */
export const SUBSCRIPTION_METHOD = "oauth";
export const CREATE_KEY_METHOD = "create-api-key";
export const REQUIRED_BETAS = ["oauth-2025-04-20", "interleaved-thinking-2025-05-14"];
export const CLAUDE_CODE_USER_AGENT = "claude-cli/2.1.2 (external, cli)";
export const CLAUDE_CODE_SYSTEM = "You are Claude Code, Anthropic's official CLI for Claude.";
const TOOL_PREFIX = "mcp_";
/** Kľúč z „Create an API Key“ nevyprší a nemá obnovu. */
const NEVER_EXPIRES = Number.MAX_SAFE_INTEGER;

type Pkce = { verifier: string; challenge: string };
type Active = { kind: "subscription" | "key"; token: string };
type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const base64Url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");

export async function generatePkce(): Promise<Pkce> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

export function authorizeUrl(mode: "max" | "console", pkce: Pkce): string {
  const url = new URL(`https://${mode === "console" ? "console.anthropic.com" : "claude.ai"}/oauth/authorize`);
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", pkce.verifier);
  return url.toString();
}

type Tokens = { access: string; refresh: string; expires: number };

async function tokenRequest(body: Json, failure: string): Promise<Tokens> {
  const response = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${failure} (HTTP ${response.status}).`);
  const json: unknown = await response.json();
  if (!isRecord(json) || typeof json.access_token !== "string" || typeof json.refresh_token !== "string" || typeof json.expires_in !== "number")
    throw new Error(`${failure}: Anthropic returned an incomplete token.`);
  return { access: json.access_token, refresh: json.refresh_token, expires: Math.floor(Date.now() + json.expires_in * 1000) };
}

/** Kód z prehliadača má tvar `kód#stav`, ako ho ukáže stránka Anthropic. */
export function exchange(code: string, verifier: string): Promise<Tokens> {
  const [authorization, state] = code.trim().split("#");
  return tokenRequest({ code: authorization, state, grant_type: "authorization_code", client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, code_verifier: verifier },
    "Anthropic sign-in failed");
}

const oauth = (methodID: string, tokens: Tokens) => Credential.OAuth.make({ type: "oauth", methodID: Integration.MethodID.make(methodID), ...tokens });

export async function refreshSubscription(credential: Credential.OAuth): Promise<Credential.OAuth> {
  const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: credential.refresh, client_id: CLIENT_ID }, "Anthropic token refresh failed");
  return Credential.OAuth.make({ ...credential, ...tokens });
}

async function createApiKey(access: string): Promise<string> {
  const response = await fetch(CREATE_KEY_URL, { method: "POST", headers: { "Content-Type": "application/json", authorization: `Bearer ${access}` } });
  if (!response.ok) throw new Error(`Anthropic could not create an API key (HTTP ${response.status}).`);
  const json: unknown = await response.json();
  if (!isRecord(json) || typeof json.raw_key !== "string" || !json.raw_key) throw new Error("Anthropic did not return an API key.");
  return json.raw_key;
}

/** Systémový text bez značky OpenCode; cesty a názvy súborov (`.opencode/skills`, `opencode.json`) ostávajú. */
export function sanitizeSystemText(text: string): string {
  return text.replace(/OpenCode/g, "Claude Code").replace(/(?<![\w./\\-])opencode(?![\w./\\-])/gi, "Claude");
}

const prefixed = (name: unknown) => typeof name === "string" && name && !name.startsWith(TOOL_PREFIX) ? `${TOOL_PREFIX}${name}` : name;

/** Telo `/v1/messages` pre predplatné. Neznáme tvary ostávajú bez zmeny. */
export function subscriptionBody(body: Json): Json {
  const result: Json = { ...body };
  const blocks = typeof body.system === "string" ? [{ type: "text", text: body.system }] : Array.isArray(body.system) ? body.system : [];
  const system = blocks.map((item: unknown) => isRecord(item) && item.type === "text" && typeof item.text === "string" ? { ...item, text: sanitizeSystemText(item.text) } : item);
  // Ako pôvodný balík: samostatný úvod Claude Code a ten istý úvod pred prvým textom.
  const first = system[0];
  if (!(isRecord(first) && first.text === CLAUDE_CODE_SYSTEM)) {
    if (isRecord(first) && typeof first.text === "string") system[0] = { ...first, text: `${CLAUDE_CODE_SYSTEM}\n\n${first.text}` };
    system.unshift({ type: "text", text: CLAUDE_CODE_SYSTEM });
  }
  result.system = system;
  if (Array.isArray(body.tools)) result.tools = body.tools.map((tool: unknown) => isRecord(tool) ? { ...tool, name: prefixed(tool.name) } : tool);
  if (isRecord(body.tool_choice) && body.tool_choice.type === "tool") result.tool_choice = { ...body.tool_choice, name: prefixed(body.tool_choice.name) };
  if (Array.isArray(body.messages)) result.messages = body.messages.map((message: unknown) => {
    if (!isRecord(message) || !Array.isArray(message.content)) return message;
    return { ...message, content: message.content.map((block: unknown) => isRecord(block) && block.type === "tool_use" ? { ...block, name: prefixed(block.name) } : block) };
  });
  return result;
}

export function mergedBetas(incoming: string | null): string {
  return [...new Set([...REQUIRED_BETAS, ...(incoming ?? "").split(",").map(beta => beta.trim()).filter(Boolean)])].join(",");
}

/** Požiadavka na API Anthropic s pripojeným predplatným alebo vytvoreným kľúčom. */
export async function anthropicRequest(request: Request, active: Active): Promise<Request> {
  const headers = new Headers(request.headers);
  if (active.kind === "key") {
    headers.delete("authorization");
    headers.set("x-api-key", active.token);
    return new Request(request, { headers });
  }
  headers.set("authorization", `Bearer ${active.token}`);
  headers.set("anthropic-beta", mergedBetas(headers.get("anthropic-beta")));
  headers.set("user-agent", CLAUDE_CODE_USER_AGENT);
  headers.delete("x-api-key");
  const url = new URL(request.url);
  if (url.pathname.endsWith("/v1/messages") && !url.searchParams.has("beta")) url.searchParams.set("beta", "true");
  let body: string | undefined;
  if (request.body && !["GET", "HEAD"].includes(request.method)) {
    body = await request.clone().text();
    try {
      const parsed: unknown = JSON.parse(body);
      if (isRecord(parsed)) {
        body = JSON.stringify(subscriptionBody(parsed));
        headers.delete("content-length");
      }
    } catch { /* Telo, ktoré nie je JSON, ostáva bez zmeny. */ }
  }
  return new Request(url, { method: request.method, headers, body, signal: request.signal, redirect: request.redirect });
}

/** Odpoveď bez predpony `mcp_`; prúd SSE sa upravuje po celých riadkoch, nie po kúskoch prenosu. */
export function anthropicResponse(response: Response): Response {
  if (!response.body) return response;
  const decoder = new TextDecoder(), encoder = new TextEncoder();
  const restore = (text: string) => text.replace(/"name"\s*:\s*"mcp_([^"]+)"/g, '"name": "$1"');
  let pending = "";
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      const end = pending.lastIndexOf("\n");
      if (end < 0) return;
      controller.enqueue(encoder.encode(restore(pending.slice(0, end + 1))));
      pending = pending.slice(end + 1);
    },
    flush(controller) {
      pending += decoder.decode();
      if (pending) controller.enqueue(encoder.encode(restore(pending)));
    },
  }));
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export const LawossAnthropicAuth = Plugin.define({
  id: "lawoss.anthropic-auth",
  async setup(ctx) {
    let subscribed = false;
    /** Aktívne pripojenie Anthropic tejto inštalácie; obnovený token dodá engine (`connection.resolve`). */
    const active = async (): Promise<Active | undefined> => {
      const connection = await ctx.integration.connection.active(PROVIDER).catch(() => undefined);
      if (!connection || connection.type !== "credential" || connection.method !== "oauth") return undefined;
      const credential = await ctx.integration.connection.resolve(connection).catch(() => undefined);
      if (credential?.type !== "oauth") return undefined;
      if (credential.methodID === SUBSCRIPTION_METHOD) return { kind: "subscription", token: credential.access };
      if (credential.methodID === CREATE_KEY_METHOD) return { kind: "key", token: credential.access };
      return undefined;
    };
    const sync = async () => {
      const next = (await active())?.kind === "subscription";
      if (next === subscribed) return;
      subscribed = next;
      await ctx.model.reload();
    };
    const registrations = [
      await ctx.integration.transform(editor => {
        editor.method.update({
          integrationID: PROVIDER,
          method: { id: SUBSCRIPTION_METHOD, type: "oauth", label: "Claude Pro/Max" },
          authorize: async () => {
            const pkce = await generatePkce();
            return { mode: "code", url: authorizeUrl("max", pkce), instructions: "Paste the authorization code here: ",
              callback: async (code: string) => oauth(SUBSCRIPTION_METHOD, await exchange(code, pkce.verifier)) };
          },
          refresh: refreshSubscription,
        });
        editor.method.update({
          integrationID: PROVIDER,
          method: { id: CREATE_KEY_METHOD, type: "oauth", label: "Create an API Key" },
          authorize: async () => {
            const pkce = await generatePkce();
            return { mode: "code", url: authorizeUrl("console", pkce), instructions: "Paste the authorization code here: ",
              callback: async (code: string) => {
                const tokens = await exchange(code, pkce.verifier);
                return oauth(CREATE_KEY_METHOD, { access: await createApiKey(tokens.access), refresh: "", expires: NEVER_EXPIRES });
              } };
          },
        });
      }),
      // Predplatné neúčtuje tokeny (pôvodný balík nuloval ceny).
      await ctx.model.transform(editor => {
        if (!subscribed) return;
        for (const model of editor.list(PROVIDER)) editor.update(PROVIDER, model.id, draft => { draft.cost = []; });
      }),
      await ctx.session.hook("http.request", async event => {
        const current = await active();
        if (current?.kind === "subscription" && !subscribed) void sync();
        if (current) event.request = await anthropicRequest(event.request, current);
      }, { providerID: PROVIDER }),
      await ctx.session.hook("http.response", async event => {
        if ((await active())?.kind === "subscription") event.response = anthropicResponse(event.response);
      }, { providerID: PROVIDER }),
    ];
    // Prepnutie alebo nové prihlásenie mení ceny; prúd udalostí je len živý, preto sa stav načíta aj hneď.
    const controller = new AbortController();
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
            if (event.type === "credential.switched" || event.type === "credential.updated") await sync().catch(() => undefined);
          }
        } catch { /* Prerušený prúd sa znova pripojí. */ }
        if (controller.signal.aborted) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    })();
    await sync().catch(() => undefined);
    return async () => {
      controller.abort();
      for (const registration of registrations) await registration.dispose();
    };
  },
});
export default LawossAnthropicAuth;
