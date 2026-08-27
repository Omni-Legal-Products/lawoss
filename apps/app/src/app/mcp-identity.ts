/**
 * The one place an MCP server's identity is derived.
 *
 * A connector carries two names: the display name someone reads ("Microsoft
 * SharePoint", "Iron Crow") and the server name the engine and opencode.jsonc
 * know it by ("sharepoint", "iron-crow"). Connect writes the second one; every
 * later operation — sign-in, logout, status lookup — has to ask for exactly
 * that same string or it addresses a server that does not exist.
 *
 * Three separate derivations used to exist. The sign-in modal's rejected any
 * display name that was not already a valid server name, so clicking "Log in"
 * on SharePoint, Google Workspace, Thomson Reuters HighQ, or any connector
 * someone had named with a space threw "server_name must be alphanumeric"
 * before the browser was ever opened — the OAuth window simply never appeared
 * (issue #86). Keeping the rule in one module is what stops that from
 * reappearing: a display name is slugified here, never validated as if it were
 * already a server name.
 */

/** Identity fields every connector shape carries, however it reached us. */
export type McpIdentity = {
  /** Explicit server name, when the catalog entry pins one. */
  id?: string;
  /** Safe server name for opencode.jsonc, when declared. */
  serverName?: string;
  /** Display name shown in the UI. */
  name: string;
};

/**
 * Slugify a display name into a server name opencode accepts: lowercase,
 * alphanumerics plus `-` and `_`, no repeated or edge dashes.
 */
export function deriveMcpServerName(displayName: string): string {
  return (
    displayName
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "mcp"
  );
}

/**
 * The server name this connector is registered under — the key in
 * opencode.jsonc and the name the engine answers to.
 */
export function getMcpIdentityKey(entry: McpIdentity): string {
  return entry.id ?? entry.serverName ?? deriveMcpServerName(entry.name);
}

/**
 * Assert a string is already a valid opencode server name. Use it on a name
 * that is meant to be one — a config key, a derived identity key — never on a
 * display name, which needs `deriveMcpServerName` instead.
 */
export function validateMcpServerName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("server_name is required");
  }
  if (trimmed.startsWith("-")) {
    throw new Error("server_name must not start with '-'");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new Error("server_name must be alphanumeric with '-' or '_'");
  }
  return trimmed;
}

/**
 * The name to hand the engine when signing a connector in. This is the single
 * function the OAuth modal uses; keeping the derivation and the validation
 * composed here is what stops a display name from being validated as if it
 * were a server name (issue #86).
 */
export function resolveMcpSignInName(entry: McpIdentity): string {
  return validateMcpServerName(getMcpIdentityKey(entry));
}
