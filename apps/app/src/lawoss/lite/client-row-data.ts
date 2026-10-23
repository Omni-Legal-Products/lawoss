/**
 * Dáta riadkov klientov pre bočný panel (alfa2 B3, oprava po review I-1, I-3, I-4): fakty sa počítajú raz pre
 * celý panel (mapa id projektu → fakty), nie pri každom riadku. Názov z karty klienta v koreni každého
 * registrovaného priečinka sa číta nezávisle od vybraného projektu (ohraničene, s cache), takže meno klienta
 * sa pri prepnutí výberu nemení.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { parseFrontmatter } from "../../../../../lawoss/okf/src/core";
import type { OkfConnection } from "../okf/connection";
import type { OkfReadResult, OkfScope } from "../okf/read-model";
import type { ClientNavModel } from "./client-projects";
import { cardTitle, clientGroupOfProject, matterSourceFresh, rowDeadline, type RowDeadline } from "./client-row";
import { comparable, within } from "./matter-conversations";
import type { ClientGroup } from "./today-model";

const CLIENT_CARDS = ["client.md", "klient.md"];
/** Najviac toľko priečinkov sa prečíta (jeden výpis koreňa a jedna karta na priečinok). */
export const MAX_CARD_READS = 100;
const CARD_TITLES_STALE_MS = 30_000;
/** Karty sa obnovia aj bez zmeny prehľadu (premenovanie klienta v karte iného, nevybraného priečinka). */
const CARD_TITLES_REFRESH_MS = 60_000;
/** Karta klienta je krátky Markdown; väčšia sa nečíta (meno ostane natívne), z prečítanej sa parsuje len začiatok. */
export const MAX_CARD_BYTES = 64 * 1024;

/** Karta klienta v koreni priečinka: či existuje a jej názov (`title`). */
export type RootCard = { card: boolean; title?: string };
type CardClient = Pick<NonNullable<OkfConnection["client"]>, "listWorkspaceDirectory" | "readWorkspaceFile">;

/** Prečíta karty klientov v koreňoch lokálnych projektov; chyba jedného priečinka = bez karty (meno ostane natívne). */
export async function readRootCards(client: CardClient, workspaces: readonly Pick<RouteWorkspace, "id">[], signal?: AbortSignal): Promise<ReadonlyMap<string, RootCard>> {
  const out = new Map<string, RootCard>();
  let next = 0;
  const worker = async () => {
    while (next < workspaces.length) {
      const { id } = workspaces[next++];
      try {
        const listing = await client.listWorkspaceDirectory(id, "", { signal });
        const card = listing.entries.find((e) => e.kind === "file" && CLIENT_CARDS.includes(e.name));
        if (!card) { out.set(id, { card: false }); continue; }
        if (card.size !== undefined && card.size > MAX_CARD_BYTES) { out.set(id, { card: true }); continue; }
        const title = parseFrontmatter((await client.readWorkspaceFile(id, card.name, { signal })).content.slice(0, MAX_CARD_BYTES))?.title;
        out.set(id, typeof title === "string" && title.trim() ? { card: true, title: title.trim() } : { card: true });
      } catch {
        signal?.throwIfAborted();
        out.set(id, { card: false });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, workspaces.length) }, worker));
  return out;
}

const NO_CARDS: ReadonlyMap<string, RootCard> = new Map();

/**
 * Karty klientov všetkých registrovaných lokálnych priečinkov panela (nie len vybraného). Obnovia sa, keď sa zmení
 * prehľad OKF (`refreshKey`, napr. zmenená karta vybraného klienta), a periodicky pre nevybrané priečinky.
 */
export function useRootCards(connection: OkfConnection | null, refreshKey?: unknown): ReadonlyMap<string, RootCard> {
  const projects = useMemo(() => (connection?.workspaces ?? []).filter((w) => w.workspaceType !== "remote" && Boolean(w.path)).slice(0, MAX_CARD_READS), [connection?.workspaces]);
  const key = projects.map((w) => `${w.id}\u0000${w.path}`).join("\u0001");
  const client = connection?.client ?? null;
  const query = useQuery({
    queryKey: ["lawoss-client-root-cards", connection?.baseUrl ?? "", connection?.authGeneration ?? 0, key],
    enabled: client !== null && projects.length > 0,
    staleTime: CARD_TITLES_STALE_MS,
    refetchInterval: CARD_TITLES_REFRESH_MS,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => client ? readRootCards(client, projects, signal) : Promise.resolve(NO_CARDS),
  });
  // Nové čítanie prehľadu (iný objekt dát) = karty sa prečítajú znova, prvé načítanie sa nezdvojuje.
  const queryClient = useQueryClient();
  const seen = useRef(refreshKey);
  useEffect(() => {
    if (seen.current === refreshKey) return;
    seen.current = refreshKey;
    void queryClient.invalidateQueries({ queryKey: ["lawoss-client-root-cards"] });
  }, [refreshKey, queryClient]);
  return query.data ?? NO_CARDS;
}

/** Čo riadok projektu vie bez ohľadu na natívne meno a jazyk (to sa doplní pri vykreslení). */
export type ClientRowFacts = {
  /** Klient (karta v koreni, karta z prehľadu alebo člen praxe): smie dostať meno z karty / upravené meno priečinka. */
  eligible: boolean;
  cardTitle?: string;
  path: string | null;
  /** Najbližšia lehota len pri presnom klientovi (nie koreň praxe s viacerými klientmi). */
  deadline: RowDeadline | null;
};

type RowInputs = {
  workspaces: readonly Pick<RouteWorkspace, "id" | "path">[];
  scope: OkfScope | null;
  data: OkfReadResult | undefined;
  groups: readonly ClientGroup[];
  model: Pick<ClientNavModel, "clients">;
  excludedWorkspaceIds: readonly string[];
  rootCards: ReadonlyMap<string, RootCard>;
  todayIso: string;
};

/** Fakty všetkých riadkov naraz (jedno prejdenie skupín na projekt; lehoty len zo skupiny presného klienta). */
export function buildClientRows(input: RowInputs): ReadonlyMap<string, ClientRowFacts> {
  const { scope, data, groups, model, todayIso } = input;
  const excluded = new Set(input.excludedWorkspaceIds);
  const practice = scope?.practiceRoot ? comparable(scope.practiceRoot) : null;
  const rows = new Map<string, ClientRowFacts>();
  for (const w of input.workspaces) {
    const path = w.path || null;
    const root = input.rootCards.get(w.id);
    const group = !excluded.has(w.id) ? clientGroupOfProject(scope, groups, path) : null;
    const member = Boolean(practice && path && !excluded.has(w.id) && model.clients.has(w.id) && within(practice, comparable(path)));
    const title = (group ? cardTitle(data, group.key) : undefined) ?? root?.title;
    const fresh = group !== null && group.matters.every((m) => matterSourceFresh(data, scope, m.path));
    const deadline = group ? rowDeadline(group.matters.flatMap((m) => m.deadlines), todayIso, fresh) : null;
    rows.set(w.id, { eligible: Boolean(root?.card) || group !== null || member, ...(title ? { cardTitle: title } : {}), path, deadline });
  }
  return rows;
}
