import type { QueryClient } from "@tanstack/react-query";

import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { t } from "@/i18n";
import { binaryMatchesStat, retainBinaryContent } from "./binary-content";
import type { BinaryData, OpenTarget, TextData } from "./open-target";

export type ArtifactQueryState =
  | (TextData & { updatedAt: number | null })
  | (BinaryData & { contentType: string | null; updatedAt: number | null; downloadedUpdatedAt?: number | null; revision: number });

let fallbackBinaryRevision = 0;

export function nextBinaryRevision(updatedAt: number | null) {
  if (updatedAt !== null) return updatedAt;
  fallbackBinaryRevision += 1;
  return fallbackBinaryRevision;
}

export function isTextContent(target: OpenTarget): boolean {
  return ["markdown", "text", "sheet", "html"].includes(target.preview) && !/\.(xlsx|xls|ods)$/i.test(target.value);
}

type ArtifactQueryInput = {
  queryClient: QueryClient;
  client: Pick<LegalworkServerClient, "baseUrl" | "readWorkspaceFile" | "statWorkspaceFile" | "downloadWorkspaceFile">;
  workspaceId: string;
  target: OpenTarget;
  generation: number | undefined;
  localReadOnly: boolean;
  isReader: () => boolean;
};

/** One key for the panel's query, its comparison with the previous bytes and its saves (#367). */
export function artifactQueryKey(workspaceId: string, target: Pick<OpenTarget, "id">, baseUrl: string, generation: number | undefined) {
  return ["artifact-panel", workspaceId, target.id, baseUrl, generation] as const;
}

export function artifactQueryOptions({ queryClient, client, workspaceId, target, generation, localReadOnly, isReader }: ArtifactQueryInput) {
  const queryKey = artifactQueryKey(workspaceId, target, client.baseUrl, generation);
  return {
    queryKey,
    queryFn: async (): Promise<ArtifactQueryState> => {
      if (target.kind === "url") {
        throw new Error(t("artifact.urls_open_in_browser"));
      }
      else if (target.exists === false) {
        throw new Error(t("artifact.file_not_found"));
      }

      if (isTextContent(target)) {
        const result = await client.readWorkspaceFile(workspaceId, target.value);

        return { kind: "text", data: result.content, updatedAt: result.updatedAt ?? null };
      }

      const previous = queryClient.getQueryData<ArtifactQueryState>(queryKey);
      if ((localReadOnly || isReader()) && previous?.kind === "binary") {
        // Older servers without stat/version metadata retain the download path.
        const stat = await client.statWorkspaceFile(workspaceId, target.value).catch(() => null);
        if (stat && binaryMatchesStat(previous, stat)) return previous;
      }
      const result = await client.downloadWorkspaceFile(workspaceId, target.value);
      const updatedAt = result.updatedAt ?? target.updatedAt ?? null;

      return {
        kind: "binary",
        data: retainBinaryContent(previous?.kind === "binary" ? previous.data : undefined, result.data),
        contentType: result.contentType,
        downloadedUpdatedAt: result.updatedAt,
        updatedAt,
        revision: nextBinaryRevision(result.updatedAt),
      };
    },
    refetchInterval: localReadOnly ? 2000 : false as const,
    refetchOnMount: "always" as const,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  };
}
