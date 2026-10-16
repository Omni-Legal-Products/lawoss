import type { ViewInput, ViewOwner, ViewRecord } from "@legalwork/types/views";
import { LegalworkServerError } from "@/app/lib/legalwork-server";
import { t } from "@/i18n";

export const sameViewOwner = (a: ViewOwner, b: ViewOwner) => a.kind === b.kind && a.id === b.id;
export const viewOwnerKey = (owner: ViewOwner) => `${owner.kind}:${owner.id}`;
export const preferredSavedView = (views: ViewRecord[], source: ViewOwner) => views.find(view => sameViewOwner(view.owner, source)) ?? views[0];
export const isViewSaveConflict = (error: unknown) => error instanceof LegalworkServerError && error.code === "view_revision_conflict";

/** Copies keep the reviewed data and original source links, never rebind queries to another wiki. */
export function viewInputForDestination(input: ViewInput, source: ViewOwner, destination: ViewOwner): ViewInput {
  if (sameViewOwner(source, destination)) return input.mode === "dashboard" && source.kind === "wiki"
    ? { ...input, datasets: Object.fromEntries(Object.entries(input.datasets ?? {}).filter(([name]) => !Object.hasOwn(input.queries, name))) } : input;
  if (Object.keys(input.queries).some(name => !input.datasets?.[name])) throw new Error(t("views.copy_refresh_required"));
  return { ...input, queries: {}, datasets: Object.fromEntries(Object.entries(input.datasets ?? {}).map(([name, data]) => [name, { ...data, sourceOwner: data.sourceOwner ?? source }])) };
}

export function viewInput(record: ViewInput): ViewInput {
  const { version, title, mode, catalog, program, queries, datasets, fallbackMarkdown } = record;
  return { version, title, mode, catalog, program, queries, datasets, fallbackMarkdown };
}
