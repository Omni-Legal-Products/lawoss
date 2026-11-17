/**
 * LAWOSS #410: base URLs of the local model-server templates. The app prefills
 * them and the server classifies saved endpoints from them, so both read one list.
 */
export const LOCAL_RUNTIME_BASE_URLS = {
  llamacpp: "http://localhost:8080/v1",
  vllm: "http://localhost:8000/v1",
  localai: "http://localhost:8080/v1",
  ollama: "http://localhost:11434/v1",
  lmstudio: "http://localhost:1234/v1",
} as const;

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** A plain loopback URL on a local template's port and path; these servers speak Chat Completions. */
export function isLocalRuntimeEndpoint(baseURL: unknown): boolean {
  if (typeof baseURL !== "string") return false;
  try {
    const url = new URL(baseURL.trim());
    if (!["http:", "https:"].includes(url.protocol) || !LOOPBACK_HOSTS.includes(url.hostname)
      || url.username || url.password || url.search || url.hash) return false;
    const path = url.pathname.replace(/\/+$/, "");
    return Object.values(LOCAL_RUNTIME_BASE_URLS).some((template) => {
      const endpoint = new URL(template);
      return url.port === endpoint.port && path === endpoint.pathname;
    });
  } catch {
    return false;
  }
}
