import type { QueryClient } from "@tanstack/react-query";
import type { ModelRef } from "@/app/types";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { unwrap, preflightOpencodeDirectory, type createClient } from "@/app/lib/opencode";
import { ensureProviderListQuery } from "@/react-app/infra/provider-list-query";
import { modelReadiness } from "@/lawoss/shell/model-readiness";
import { isAgentCapableModel } from "@/lawoss/shell/default-model-pick";
import { t } from "@/i18n";
import { freshDocumentSources, listAllDocuments, type DocumentGenerationRequest } from "./document-processing";

export function documentExecutionDirectory(root: string, relative: string, isRemote: boolean): { directory: string; relative: string } {
  const path = relative.trim().replaceAll("\\", "/");
  if (!root || path.startsWith("/") || path.includes(":") || path.split("/").some(part => part === "." || part === "..") || (isRemote && path)) throw new Error(t("documents.invalid_directory"));
  return { directory: path ? `${root.replace(/[/\\]+$/, "")}/${path}` : root, relative: path };
}

export async function preflightDocumentGeneration(input: {
  queryClient: QueryClient; sdk: ReturnType<typeof createClient>; baseUrl: string; directory: string; relative: string;
  legalwork: LegalworkServerClient; workspaceId: string; model: ModelRef | null | undefined; request: DocumentGenerationRequest;
}): Promise<void> {
  const catalog = await ensureProviderListQuery(input.queryClient, { client: input.sdk, baseUrl: input.baseUrl, directory: input.directory, force: true });
  if (!input.model) throw new Error(t("session_route.no_model"));
  if (!modelReadiness({ defaultModel: input.model, providerList: catalog }).hasUsableModel) throw new Error(t("session_route.model_unavailable"));
  const selected = catalog.all.find(provider => provider.id === input.model!.providerID)?.models[input.model.modelID];
  if (!selected || !isAgentCapableModel(input.model.modelID, selected)) throw new Error(t("documents.tool_model"));
  // Mounted SDK query/header canonical guard runs before files/list checks directory kind.
  unwrap(await preflightOpencodeDirectory(input.sdk, input.directory));
  await input.legalwork.listWorkspaceDirectory(input.workspaceId, input.relative);
  const paths = input.request.sources.filter(source => !source.provenance.parentId).map(source => source.path);
  if (!paths.length) throw new Error(t("documents.no_sources"));
  const fresh = await freshDocumentSources(input.legalwork, input.workspaceId, paths, await listAllDocuments(input.legalwork, input.workspaceId));
  if (fresh.length !== input.request.sources.length || fresh.some(source => source.freshness !== "current" || !input.request.sources.some(expected => expected.id === source.id && expected.hash === source.hash))) throw new Error(t("documents.sources_changed"));
}
