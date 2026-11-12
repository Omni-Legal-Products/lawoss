import type { ConfigProvider } from "@opencode/schema/config/provider";
import { lstat, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import { engineProjectStatus } from "../engine-project.js";
import { opencodeConfigPaths } from "../workspace-files.js";
import type { ServerConfig } from "../types.js";

/** Repair only the known local Ollama endpoint, never a remote Responses gateway. */
export function repairOllamaProvider(provider: typeof ConfigProvider.Info.Type): typeof ConfigProvider.Info.Type {
  if (provider.package !== "@opencode/ai/providers/openai/responses" || typeof provider.settings?.baseURL !== "string") return provider;
  try {
    const url = new URL(provider.settings.baseURL);
    if (!["http:", "https:"].includes(url.protocol)
      || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      || url.port !== "11434" || url.pathname.replace(/\/+$/, "") !== "/v1"
      || url.username || url.password || url.search || url.hash) return provider;
    return { ...provider, package: "@opencode/ai/providers/openai-compatible" };
  } catch {
    return provider;
  }
}

/** Never reactivate an ID that an authored native document could redirect to a remote provider. */
export async function canRestoreOllamaActivation(config: ServerConfig, workspaceId: string): Promise<boolean> {
  if (config.engineConfigurationMode !== "managed") return false;
  const workspace = config.workspaces.find(item => item.id === workspaceId);
  if (!workspace) return false;
  const project = await engineProjectStatus(config, workspace);
  if (project.state !== "ready") return false;
  for (let directory = project.directory; ; directory = dirname(directory)) {
    for (const path of opencodeConfigPaths(directory)) {
      if (path === project.projection.path) continue;
      const info = await lstat(path).catch(error => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
        throw error;
      });
      if (!info) continue;
      if (!info.isFile() || info.size > 64 * 1024) return false;
      const errors: ParseError[] = [];
      const document: unknown = parse(await readFile(path, "utf8"), errors, { allowTrailingComma: true });
      // Empty native placeholders are harmless. Anything else needs resolved native provenance, not a guess.
      if (errors.length || !document || typeof document !== "object" || Array.isArray(document)
        || Object.keys(document).some(key => key !== "$schema")) return false;
    }
    if (dirname(directory) === directory) return true;
  }
}
