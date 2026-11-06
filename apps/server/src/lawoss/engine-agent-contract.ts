/** LAWOSS: shared by the server and the engine's plugins; plugins are packaged outside the server's tree. */
export const WIKI_AGENT_TICKET_ENV = "LEGALWORK_WIKI_AGENT_TICKET";
export const WIKI_AGENT_TICKET_PATH = "/engine-agent/ticket";

/** The model relays this refusal to the lawyer. */
export const ENGINE_CONNECTION_REFUSED = "This chat cannot use this client's files now: LAWOSS could not confirm its connection to its AI engine. Nothing was read or changed. Stop the task and tell the user in their language, without error codes or technical terms: quit LAWOSS completely, open it again and send the message again.";

/** Plugin bundles are separate modules, and each engine instance runs their factories again. */
const HOLDER = Symbol.for("lawoss.wiki-agent-secret");

export type WikiAgentHolder = { secret: string; failed: boolean; pending: Promise<void> | null; engineConfig?: string };
const isHolder = (value: unknown): value is WikiAgentHolder => typeof value === "object" && value !== null && "secret" in value && "failed" in value;

export function wikiAgentHolder(): WikiAgentHolder {
  const found: unknown = Reflect.get(globalThis, HOLDER);
  if (isHolder(found)) return found;
  const created: WikiAgentHolder = { secret: "", failed: false, pending: null };
  Object.defineProperty(globalThis, HOLDER, { value: created, enumerable: false, writable: false, configurable: false });
  return created;
}

export function wikiAgentSecret(): string {
  return wikiAgentHolder().secret;
}

export function wikiAgentSecretFailed(): boolean {
  return wikiAgentHolder().failed;
}

/** For tests that call plugin code in-process, without an engine. */
export function adoptWikiAgentSecret(secret: string): void {
  Object.assign(wikiAgentHolder(), { secret, failed: false, pending: null, engineConfig: undefined });
}
