import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectTemplateCatalog } from "@legalwork/types/workspace";
import { LegalworkServerError, type LegalworkServerClient } from "@/app/lib/legalwork-server";
import { useProjectDefaultsStore } from "./project-defaults-store";

/** Import the browser's previous defaults once, without overwriting a configured server. */
export async function loadProjectTemplateCatalog(client: LegalworkServerClient) {
  let catalog = await client.getProjectTemplates();
  const legacy = useProjectDefaultsStore.getState();
  if (!legacy.migrated) {
    if (catalog.revision === 0 && legacy.hasLegacyDefaults) {
      try {
        catalog = await client.saveProjectTemplates({ revision: 0, templates: legacy.templates, defaultTemplateId: legacy.defaultTemplateId });
      } catch (error) {
        if (!(error instanceof LegalworkServerError) || error.status !== 409) throw error;
        catalog = await client.getProjectTemplates();
      }
    }
    useProjectDefaultsStore.setState({ migrated: true });
  }
  return catalog;
}

export function useProjectTemplateCatalog(client: LegalworkServerClient | null, enabled = true) {
  const queryClient = useQueryClient();
  const key = ["project-templates", client?.baseUrl];
  const serverKey = useProjectDefaultsStore((state) => state.serverKey);
  const query = useQuery({
    queryKey: key,
    queryFn: () => {
      if (!client) throw new Error("Project server unavailable.");
      return loadProjectTemplateCatalog(client);
    },
    enabled: Boolean(client && enabled),
    staleTime: 30_000,
    retry: false,
  });
  useEffect(() => {
    if (client && enabled && query.data) useProjectDefaultsStore.setState({ ...query.data, serverKey: client.baseUrl });
  }, [client, enabled, query.data]);
  const mutation = useMutation({
    mutationFn: async (edit: (catalog: ProjectTemplateCatalog) => ProjectTemplateCatalog) => {
      const current = queryClient.getQueryData<ProjectTemplateCatalog>(key);
      if (!client || !current) throw new Error("Project templates unavailable.");
      return client.saveProjectTemplates(edit(current));
    },
    onSuccess: (catalog) => { queryClient.setQueryData(key, catalog); },
    onError: () => { void queryClient.invalidateQueries({ queryKey: key }); },
  });
  return { ...query, ready: query.isSuccess && !query.isError && serverKey === client?.baseUrl, save: mutation.mutateAsync, saving: mutation.isPending };
}
