/** A worker's filesystem paths cannot be opened on the desktop client. */
export function isLocalDraftServer(baseUrl: string) {
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname); }
  catch { return false; }
}
