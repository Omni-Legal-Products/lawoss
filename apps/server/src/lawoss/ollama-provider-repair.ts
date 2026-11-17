import type { ConfigProvider } from "@opencode/schema/config/provider";
import { isLocalRuntimeEndpoint, LOCAL_RUNTIME_BASE_URLS } from "@legalwork/types/local-runtime-endpoints";

const OLLAMA_PORT = new URL(LOCAL_RUNTIME_BASE_URLS.ollama).port;

/** Repair only the known local Ollama endpoint, never a remote Responses gateway. */
export function repairOllamaProvider(provider: typeof ConfigProvider.Info.Type): typeof ConfigProvider.Info.Type {
  const baseURL = provider.settings?.baseURL;
  if (provider.package !== "@opencode/ai/providers/openai/responses" || typeof baseURL !== "string") return provider;
  if (!isLocalRuntimeEndpoint(baseURL) || new URL(baseURL.trim()).port !== OLLAMA_PORT) return provider;
  return { ...provider, package: "@opencode/ai/providers/openai-compatible" };
}
