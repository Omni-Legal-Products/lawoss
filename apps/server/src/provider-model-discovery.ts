import { ApiError } from "./errors.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 🟡 LAWOSS #524: OpenAI's 401 for a restricted project key names the missing permission or scope (api.model.read).
const MISSING_SCOPE = /insufficient permissions|missing scopes?|api\.model\.read/i;

/** Only the classification leaves the worker; the body (it can echo part of the key) is never returned. */
async function missingScope(response: Response): Promise<boolean> {
  try {
    return MISSING_SCOPE.test((await response.text()).slice(0, 16_384));
  } catch {
    return false;
  }
}

/** Discover on the worker so localhost refers to the machine running inference. */
export async function discoverProviderModels(baseURL: unknown, apiKey: unknown): Promise<string[]> {
  let url: URL;
  try {
    if (typeof baseURL !== "string" || !baseURL.trim()) throw new Error();
    url = new URL(baseURL.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error();
    }
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
  } catch {
    throw new ApiError(400, "invalid_base_url", "Enter an HTTP or HTTPS base URL without credentials, a query, or a fragment.");
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (typeof apiKey === "string" && apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
  let response: Response;
  try {
    response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new ApiError(502, "model_discovery_failed", "Could not reach the model endpoint from this worker. Check the URL and that the model server is running.");
  }
  if (!response.ok) {
    // 🟡 LAWOSS #502: a rejected key gets its own code so the app can refuse to save it.
    // 🟡 LAWOSS #524: a restricted key without the model-list scope also gets 401; it is not rejected.
    const code = response.status !== 401 ? "model_discovery_failed"
      : await missingScope(response) ? "model_discovery_scope_missing" : "model_discovery_unauthorized";
    throw new ApiError(502, code, `Model endpoint returned HTTP ${response.status}.`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(502, "invalid_model_inventory", "Model endpoint did not return a JSON model list.");
  }
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new ApiError(502, "invalid_model_inventory", "Model endpoint did not return an OpenAI-compatible model list.");
  }
  return [...new Set(payload.data.flatMap((entry: unknown) => (
    isRecord(entry) && typeof entry.id === "string" && entry.id.trim() ? [entry.id.trim()] : []
  )))].sort();
}
