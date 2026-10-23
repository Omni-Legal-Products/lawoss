/**
 * Dáta stromu, detailu veci a prehľadu klienta: jeden zdieľaný výpis priečinka klienta (podstrom),
 * priradenie rozhovorov klientovi alebo veci podľa priečinka a akcie nad nimi.
 * Model je v `client-tree.ts` a `matter-conversations.ts`; tu je len napojenie na React Query a trasu.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { workspaceSessionRoute } from "@/react-app/shell/workspace-routes";
import type { MatterOverview } from "../../../../../lawoss/okf/read";
import type { OkfConnection } from "../okf/connection";
import { openMatterSession } from "../okf/matter-session";
import { canActOnSource, localMatter, locateInScope, type OkfReadResult, type OkfScope } from "../okf/read-model";
import { t, type Language } from "@/i18n";
import { toast } from "@/components/ui/sonner";
import { isScopeRefusal, revalidateScopeTarget, type RecheckTarget } from "../okf/scope-target";
import { buildClientTree, clearFocusOverrides, clientFolderFor, clientToggle, directoryFocus, fetchPlan, matterSource, routeFocus, sessionFocus, type ConversationList, type TreeFocus } from "./client-tree";
import { liteMatterLink } from "./links";
import {
  assignConversations, comparable, FOLDER_SESSIONS_KEY, folderEngine, folderPath, openMatterConversation, readSessionDirectory, rebaseDirectory, useFolderListings, within,
  type Folder, type FolderListing, type FolderState, type MatterConversation, type Owners,
} from "./matter-conversations";
import { quickActionPrompt } from "./quick-actions";
import { clientOf, groupByClient, type ClientGroup } from "./today-model";

/** Stav navigácie: „+ Nový rozhovor“ zo stromu zlyhal; detail veci to povie jednou vetou. */
export const TREE_FAILURE_STATE = { lawossTreeFailure: true } as const;
export const isTreeFailure = (state: unknown): boolean => typeof state === "object" && state !== null && "lawossTreeFailure" in state;

/** Cesta z prehľadu → priečinok na čítanie (registrovaný priečinok a absolútna cesta). */
export function scopeFolder(scope: OkfScope | null, relative: string | null): Folder | null {
  if (relative === null || !scope) return null;
  const at = locateInScope(scope, relative);
  return at && at.workspace.workspaceType !== "remote" && at.workspace.path ? { workspace: at.workspace, abs: folderPath(at.workspace, at.path) } : null;
}

const clientFolderOfGroup = (scope: OkfScope | null, group: Pick<ClientGroup, "key" | "matters">) => scopeFolder(scope, clientFolderFor(group.key, group.matters[0]?.path ?? ""));

export function ownersOf(scope: OkfScope | null, groups: readonly Pick<ClientGroup, "key" | "matters">[]): Owners {
  const folder = (f: Folder | null) => f ? comparable(f.abs) : null;
  return {
    clients: groups.map((g) => ({ key: g.key, folder: folder(clientFolderOfGroup(scope, g)) })),
    matters: groups.flatMap((g) => g.matters).map((m) => ({ path: m.path, folder: folder(scopeFolder(scope, m.path)) })),
  };
}

const loaded = (states: ReadonlyMap<string, FolderState>): FolderListing[] => [...states.values()].flatMap((s) => s.listing ? [s.listing] : []);

/** Stav zoznamu z výpisu, ktorý ho pokrýva: chyba nie je prázdny zoznam, čakanie tiež nie. */
export function listFrom(state: FolderState | undefined, items: readonly MatterConversation[] | undefined): ConversationList {
  if (state?.listing) return { items: items ?? [], status: "ready", complete: state.listing.complete, retry: state.retry };
  if (state?.error) return { items: [], status: "error", complete: false, retry: state.retry };
  return { items: [], status: "loading", complete: false };
}

/** Rozhovory veci z toho výpisu, ktorý ich naozaj pokrýva (`matterSource`, rovnako ako plán čítania). */
function matterList(states: ReadonlyMap<string, FolderState>, root: Folder | null, folder: Folder | null, items: readonly MatterConversation[] | undefined): ConversationList {
  if (!folder) return { items: [], status: "ready", complete: true };
  const rootState = root ? states.get(comparable(root.abs)) : undefined;
  return matterSource(root, rootState?.listing, folder) === "client" ? listFrom(rootState, items) : listFrom(states.get(comparable(folder.abs)), items);
}

/**
 * Voľby stromu v natívnom bočnom paneli. `sessionDirectory`: priečinok otvoreného chatu zo živého zoznamu panela
 * (`undefined` = neznámy, prečíta sa jeden chat); s ním sa vec otvoreného chatu určí podľa jeho priečinka,
 * bez výpisu podstromu, a chat priamo v priečinku projektu (natívne Chaty) nič nerozbalí. `closedFor`: klienti,
 * ktorí sú pri danom zameraní zbalení (zatvorené Prípady projektu s viacerými klientmi), takže sa nečítajú.
 */
export type ClientTreeOptions = {
  sessionDirectory?: (workspaceId: string, sessionId: string) => string | null | undefined;
  closedFor?: (focus: Pick<TreeFocus, "client" | "matter">) => ReadonlySet<string>;
  /** Spojenie a rozsah na overenie pred akciou (#168); bez neho sa overuje tým, čo strom zobrazuje. */
  recheck?: RecheckTarget;
};

export const SESSION_DIRECTORY_KEY = "lite-session-directory";
export const FOLDER_LOCATE_KEY = "lite-folder-locate";

/**
 * Priečinok otvoreného chatu v tvare appky. Známy zo živého zoznamu, inak jedno čítanie chatu. Priečinok mimo
 * projektu v tvare appky (symbolický odkaz, diakritika z disku) sa prevedie cez tvar enginu (`GET /path`),
 * ako výpis priečinka. `undefined` = ešte sa číta.
 */
function useSessionDirectory(connection: OkfConnection | null, session: TreeFocus["session"], known: string | null | undefined, enabled: boolean): string | null | undefined {
  const workspace = session ? connection?.workspaces.find((w) => w.id === session.workspaceId) : undefined;
  const local = Boolean(workspace?.path && workspace.workspaceType !== "remote");
  const fetched = useQuery({
    queryKey: [SESSION_DIRECTORY_KEY, workspace?.id ?? "", session?.sessionId ?? "", connection?.baseUrl ?? "", connection?.token ?? ""],
    enabled: enabled && local && known === undefined && Boolean(connection?.client && session),
    staleTime: 60_000,
    queryFn: ({ signal }) => connection && workspace && session ? readSessionDirectory(connection, workspace, session.sessionId, signal) : null,
  });
  const raw = known !== undefined ? known : fetched.data;
  const direct = Boolean(raw && workspace?.path && within(comparable(workspace.path), comparable(raw)));
  const where = useQuery({
    queryKey: [FOLDER_LOCATE_KEY, workspace?.id ?? "", workspace?.path ?? "", connection?.baseUrl ?? "", connection?.token ?? ""],
    enabled: enabled && local && Boolean(raw) && !direct && Boolean(connection?.client),
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const engine = connection && workspace ? folderEngine(connection, workspace) : null;
      if (!engine || !workspace) throw new Error("no connection");
      return engine.locate(workspace.path, signal);
    },
  });
  if (!enabled || !session) return null;
  if (!local || !workspace) return null;
  if (raw === undefined) return fetched.isError ? null : undefined;
  if (raw === null || direct) return raw;
  if (where.isError) return null;
  return where.data ? rebaseDirectory(raw, where.data.directory, workspace.path) : undefined;
}

/** Bočný strom: klienti a veci z prehľadu, rozhovory len pre rozbalených klientov a otvorenú konverzáciu. */
export function useClientTree(connection: OkfConnection | null, scope: OkfScope | null, data: OkfReadResult | undefined, pathname: string, search: string, locale: Language, options: ClientTreeOptions = {}) {
  const navigate = useNavigate();
  const queries = useQueryClient();
  const running = useRef(false);
  const [overrides, setOverrides] = useState<Readonly<Record<string, boolean>>>({});
  const groups = useMemo(() => data ? groupByClient(data.matters, data.inputs, data.clients) : [], [data]);
  const route = useMemo(() => routeFocus(pathname, search), [pathname, search]);
  const clientFolders = useMemo(() => new Map(groups.map((g) => [g.key, clientFolderOfGroup(scope, g)])), [groups, scope]);
  const owners = useMemo(() => ownersOf(scope, groups), [scope, groups]);
  const folders = useMemo(() => ({ client: (key: string) => clientFolders.get(key) ?? null, matter: (path: string) => scopeFolder(scope, path) }), [clientFolders, scope]);
  // Panel pozná priečinok chatu: vec podľa priečinka, žiadny výpis podstromu (chat v koreni projektu nič nerozbalí).
  const byDirectory = Boolean(options.sessionDirectory);
  const liveDirectory = route.session && options.sessionDirectory ? options.sessionDirectory(route.session.workspaceId, route.session.sessionId) : undefined;
  const sessionDirectory = useSessionDirectory(connection, route.session, liveDirectory, byDirectory);
  // Inak: priečinok jej klienta (najhlbší, ktorý obsahuje jej registrovaný priečinok), inak ten priečinok.
  const sessionFolder = useMemo((): Folder | null => {
    if (byDirectory) return null;
    const workspace = route.session ? connection?.workspaces.find((w) => w.id === route.session?.workspaceId) : undefined;
    if (!workspace?.path || workspace.workspaceType === "remote") return null;
    const dir = comparable(workspace.path);
    const owner = [...clientFolders.values()].filter((f): f is Folder => f !== null && within(comparable(f.abs), dir)).sort((a, b) => b.abs.length - a.abs.length)[0];
    return owner ?? { workspace, abs: workspace.path };
  }, [route, connection, clientFolders, byDirectory]);
  const sessionStates = useFolderListings(connection, sessionFolder ? [sessionFolder] : []);
  const sessionProject = route.session ? connection?.workspaces.find((w) => w.id === route.session?.workspaceId)?.path ?? null : null;
  const focus = route.session ? (byDirectory ? directoryFocus(sessionDirectory, owners, sessionProject) : sessionFocus(route, assignConversations(loaded(sessionStates), owners))) : route;
  const closed = options.closedFor?.(focus);
  const effective = closed?.size ? { ...overrides, ...Object.fromEntries([...closed].map((key) => [clientToggle(key), false])) } : overrides;
  // Trasa sa presunula na uzol: jeho prepnutie sa zabudne (inak by ho navždy prebilo).
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  useEffect(() => {
    setOverrides((prev) => clearFocusOverrides(prev, { client: focus.client, matter: focus.matter }, groupsRef.current));
  }, [focus.client, focus.matter]);
  const shape = buildClientTree({ groups, focus, overrides: effective, lists: { client: () => undefined, matter: () => undefined }, canStart: () => false });
  const rootStates = useFolderListings(connection, fetchPlan(shape, folders, () => undefined, sessionFolder));
  const known = new Map([...sessionStates, ...rootStates]);
  const extra = fetchPlan(shape, folders, (folder) => known.get(folder)?.listing, sessionFolder).filter((f) => !known.has(comparable(f.abs)));
  const states = new Map([...known, ...useFolderListings(connection, extra)]);
  // Nová konverzácia alebo jej názov (dá ho agent po prvej správe): po navigácii čítať znova; nie pri prvom vykreslení.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    void queries.invalidateQueries({ queryKey: [FOLDER_SESSIONS_KEY] });
  }, [pathname, queries]);
  const assignment = assignConversations(loaded(states), owners);
  const target = useCallback((path: string) => {
    const matter = data?.matters.find((m) => m.path === path);
    const local = matter && scope && data ? localMatter(scope, matter, data.matters) : null;
    return matter && local ? { matter, local } : null;
  }, [data, scope]);
  const nodes = buildClientTree({
    groups, focus, overrides: effective,
    // #168: „+ Nový chat“ len nad čerstvo prečítaným zdrojom klienta (ako rýchle akcie na detaile prípadu).
    canStart: (path) => {
      const found = target(path);
      return found !== null && data !== undefined && canActOnSource(data, found.local.workspace.id);
    },
    lists: {
      client: (key) => {
        const root = clientFolders.get(key);
        return root ? listFrom(states.get(comparable(root.abs)), assignment.byClient.get(key)) : { items: [], status: "ready", complete: true };
      },
      matter: (path) => {
        const group = groups.find((g) => g.matters.some((m) => m.path === path));
        return matterList(states, group ? clientFolders.get(group.key) ?? null : null, scopeFolder(scope, path), assignment.byMatter.get(path));
      },
    },
  });
  const toggle = useCallback((key: string, expanded: boolean) => setOverrides((prev) => ({ ...prev, [key]: !expanded })), []);
  const check = options.recheck ?? { connection, scope, practice: Boolean(scope?.practiceRoot) };
  const run = (work: () => Promise<string>, fallback: string, explain = false) => {
    if (running.current) return;
    running.current = true;
    work().then((to) => navigate(to)).catch((failure: unknown) => {
      console.warn("LAWOSS-lite: tree conversation", failure);
      // #168: overenie praxe alebo klienta zlyhalo → nič sa neotvorí ani neaktivuje, advokát dostane vetu.
      if (isScopeRefusal(failure)) { toast.error(t("lawoss.practice.refused", locale)); return; }
      // Záloha: detail prípadu, ktorý povie, že sa rozhovor neotvoril (a čo chýba, napr. model).
      navigate(fallback, explain ? { state: TREE_FAILURE_STATE } : undefined);
    }).finally(() => { running.current = false; });
  };
  const openConversation = (conversation: MatterConversation) => {
    const route = workspaceSessionRoute(conversation.workspaceId, conversation.id);
    // Bez spojenia alebo aktivácie (napr. mimo desktopu) aspoň otvoriť konverzáciu; priečinok vyberie jej trasa.
    if (!connection) { navigate(route); return; }
    if (running.current) return;
    running.current = true;
    openCheckedConversation(conversation, { scope: check.scope, connection: check.connection ?? connection })
      .then((result) => { if (result.kind === "open") navigate(result.to); else toast.error(t(conversationFailureKey(result), locale)); })
      .finally(() => { running.current = false; });
  };
  /** Ako rýchla akcia na detaile veci: nová konverzácia v priečinku veci u jej klienta, s konceptom (nič sa neodošle). */
  const newConversation = (path: string) => {
    const found = target(path);
    if (!connection || !found) { navigate(liteMatterLink(path), { state: TREE_FAILURE_STATE }); return; }
    const { matter, local } = found;
    const prompt = quickActionPrompt("open", { title: matter.title, matterRef: matter.matterRef, path: local.selected.path }, locale);
    // #168: pred založením overiť prax a čerstvý zdroj klienta (ako rýchla akcia na detaile prípadu).
    run(async () => {
      const current = await revalidateScopeTarget(check.scope, check.connection ?? connection, local.workspace.id);
      return openMatterSession(current.connection, current.workspace, local.selected, local.discovered, prompt);
    }, liteMatterLink(path), true);
  };
  return { nodes, focus, toggle, openConversation, newConversation };
}

/** Výsledok otvorenia existujúceho chatu: trasa, odmietnuté overenie (#168), alebo iná chyba. */
export type ConversationOpen = { kind: "open"; to: string } | { kind: "refused" } | { kind: "failed" };
export const conversationFailureKey = (result: Exclude<ConversationOpen, { kind: "open" }>): string =>
  result.kind === "refused" ? "lawoss.practice.refused" : "lawoss.lite.action_error_generic";

/**
 * Existujúci chat zo stromu alebo z prehľadu klienta (#168): najprv overenie praxe, klienta a čerstvého zdroja,
 * potom aktivácia jeho priečinka. Pri akejkoľvek chybe žiadna trasa: trasa chatu by priečinok aktivovala bez overenia.
 */
export async function openCheckedConversation(
  conversation: MatterConversation,
  check: { scope: OkfScope | null; connection: OkfConnection },
  deps: { revalidate: typeof revalidateScopeTarget; open: typeof openMatterConversation } = { revalidate: revalidateScopeTarget, open: openMatterConversation },
): Promise<ConversationOpen> {
  try {
    const current = await deps.revalidate(check.scope, check.connection, conversation.workspaceId);
    return { kind: "open", to: await deps.open(current.connection, conversation) };
  } catch (failure) {
    console.warn("LAWOSS-lite: open conversation", failure);
    return isScopeRefusal(failure) ? { kind: "refused" } : { kind: "failed" };
  }
}

/** Všetky rozhovory veci pre jej detail, z toho istého výpisu ako strom. */
export function useMatterConversations(connection: OkfConnection | null, scope: OkfScope | null, data: OkfReadResult, matter: MatterOverview | null): ConversationList {
  const input = matter ? data.inputs.find((i) => i.path === matter.path) : undefined;
  const group = matter ? { key: clientOf(matter, input).key, matters: [matter] } : null;
  const root = group ? clientFolderOfGroup(scope, group) : null;
  const folder = matter ? scopeFolder(scope, matter.path) : null;
  const rootStates = useFolderListings(connection, root ? [root] : []);
  const rootListing = root ? rootStates.get(comparable(root.abs))?.listing : undefined;
  const needOwn = folder !== null && matterSource(root, rootListing, folder) === "own";
  const states = new Map([...rootStates, ...useFolderListings(connection, needOwn && folder ? [folder] : [])]);
  if (!matter) return { items: [], status: "ready", complete: true };
  const groups = groupByClient(data.matters, data.inputs, data.clients);
  const assignment = assignConversations(loaded(states), ownersOf(scope, groups));
  return matterList(states, root, folder, assignment.byMatter.get(matter.path));
}

/** Rozhovory klienta (jeho koreň a podpriečinky mimo vecí) pre prehľad klienta. */
export function useClientConversations(connection: OkfConnection | null, scope: OkfScope | null, groups: readonly ClientGroup[], key: string | null): ConversationList {
  const group = key ? groups.find((g) => g.key === key) : undefined;
  const root = group ? clientFolderOfGroup(scope, group) : null;
  const states = useFolderListings(connection, root ? [root] : []);
  if (!group || !root) return { items: [], status: "ready", complete: true };
  const assignment = assignConversations(loaded(states), ownersOf(scope, groups));
  return listFrom(states.get(comparable(root.abs)), assignment.byClient.get(group.key));
}
