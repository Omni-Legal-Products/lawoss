/** Read the effective chat policy from the server, including parent/firm rules. */
export async function requireBrowserNetwork(context, server) {
  if (typeof context?.workspaceId !== "string" || !context.workspaceId ||
      typeof context?.sessionId !== "string" || !context.sessionId) {
    throw new Error("Browser automation requires the calling project and chat.");
  }
  const token = server.ownerToken || server.clientToken;
  if (!server.running || !server.baseUrl || !token) throw new Error("Browser automation is unavailable while its network policy cannot be verified.");
  const response = await fetch(`${server.baseUrl.replace(/\/+$/, "")}/workspace/${encodeURIComponent(context.workspaceId)}/sandbox/session/${encodeURIComponent(context.sessionId)}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Browser automation is unavailable while its network policy cannot be verified.");
  const settings = await response.json();
  if (typeof settings?.enabled !== "boolean" || !["allow", "approve", "block"].includes(settings.networkMode)) {
    throw new Error("Browser automation received an invalid network policy.");
  }
  if (settings.enabled && settings.networkMode !== "allow") {
    throw new Error("Browser tools are disabled while sandboxing is on and network access is Approve or Off.");
  }
}
