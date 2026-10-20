import { locateInScope, okfScopeKey, type OkfScope, type OkfReadClient } from "./read-model";

type RawConnection = { client: OkfReadClient | null; baseUrl: string; token: string; authGeneration?: number };

/** Raw diagnostics belong to the same source owner as their practice overview. */
export function okfRawFilesQueryOptions(connection: RawConnection | null, scope: OkfScope | null, paths: readonly string[]) {
  const client = connection?.client ?? null;
  return {
    queryKey: ["okf-raw", connection?.baseUrl ?? "", connection?.token ?? "", connection?.authGeneration ?? 0, scope ? okfScopeKey(scope) : null, [...paths]],
    enabled: Boolean(client && scope && paths.length > 0),
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<Record<string,string>> => {
      signal.throwIfAborted();
      if (!client || !scope) return {};
      const out: Record<string,string> = {};
      for (const path of paths) {
        signal.throwIfAborted();
        try {
          const at = locateInScope(scope,path);
          if (!at) throw new Error("Súbor nie je v žiadnom pripojenom priečinku.");
          out[path] = (await client.readWorkspaceFile(at.workspace.id,at.path,{ signal })).content;
        } catch (error) { signal.throwIfAborted(); out[path] = error instanceof Error ? error.message : String(error); }
      }
      signal.throwIfAborted();
      return out;
    },
  };
}
