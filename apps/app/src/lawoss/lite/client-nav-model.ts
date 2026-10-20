/**
 * Prípady pod natívnym projektom: ktoré uzly stromu patria projektu, kedy sú Prípady otvorené,
 * čo robí klik na ne a ktorí klienti sa nečítajú, kým sú Prípady zbalené. Čistý model bez Reactu.
 */
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import type { ClientChoice } from "./client-choice";
import type { ClientNavModel } from "./client-projects";
import { clientToggle, focusedClientKey, type TreeClient, type TreeFocus } from "./client-tree";
import type { ClientGroup } from "./today-model";

/** Uzly stromu (klienti z prehľadu), ktoré patria projektu; `null` = projekt nie je klient OKF. */
export function projectNodes<N extends Pick<TreeClient, "key">>(nodes: readonly N[], model: Pick<ClientNavModel, "clients" | "ownerOf">, workspaceId: string): N[] | null {
  if (!model.clients.has(workspaceId)) return null;
  return nodes.filter((node) => model.ownerOf.get(node.key) === workspaceId);
}

/** Klik na Prípady: pri jednom klientovi prepne jeho uzol (zbalený nič nečíta), inak otvorí alebo zatvorí Prípady projektu. */
export type MattersToggle = { kind: "client"; key: string; expanded: boolean } | { kind: "project"; open: boolean };

/**
 * Otvorené Prípady. Jeden klient: rozbalenie jeho uzla (trasa ho rozbalí, prepnutie sa pri presune trasy zabudne).
 * Viac alebo žiadny klient: voľba používateľa, inak otvorené, keď je trasa vo veci alebo klientovi projektu.
 */
export function mattersOpen(nodes: readonly Pick<TreeClient, "key" | "expanded">[], override: boolean | undefined, focused: boolean): { open: boolean; toggle: MattersToggle } {
  if (nodes.length === 1) {
    const node = nodes[0];
    return { open: node.expanded, toggle: { kind: "client", key: clientToggle(node.key), expanded: node.expanded } };
  }
  const open = override ?? focused;
  return { open, toggle: { kind: "project", open: !open } };
}

/** Projekt, v ktorého klientovi alebo veci je trasa (prehľad klienta, detail veci, chat vo veci). */
export function focusedProject(focus: Pick<TreeFocus, "client" | "matter">, groups: readonly Pick<ClientGroup, "key" | "matters">[], ownerOf: ReadonlyMap<string, string>): string | null {
  const key = focusedClientKey(focus, groups);
  return key ? ownerOf.get(key) ?? null : null;
}

/**
 * Klienti projektov s viacerými klientmi, ktorých Prípady sú zatvorené: strom ich považuje za zbalených,
 * takže sa ich priečinky nečítajú (ani keď ich používateľ predtým rozbalil).
 */
export function closedGroups(groups: readonly Pick<ClientGroup, "key">[], ownerOf: ReadonlyMap<string, string>, overrides: Readonly<Record<string, boolean>>, focused: string | null): Set<string> {
  const count = new Map<string, number>();
  for (const owner of ownerOf.values()) count.set(owner, (count.get(owner) ?? 0) + 1);
  const closed = new Set<string>();
  for (const group of groups) {
    const owner = ownerOf.get(group.key);
    if (!owner || (count.get(owner) ?? 0) < 2) continue;
    if (!(overrides[owner] ?? focused === owner)) closed.add(group.key);
  }
  return closed;
}

/** Kam „Nový chat“ založí chat: priečinok klienta (registrovaný projekt) alebo priečinok klienta v koreni praxe. */
export type NewChatTarget = ClientChoice & { workspaceId: string; folder?: string; key?: string };

/**
 * Natívny „Nový chat“ v bežnom režime bez otvoreného projektu (rozhodnutia MČ 19. 10. 2026): klienti praxe na výber
 * a nikdy chat nad celým koreňom praxe. Registrovaní klienti sú ich projekty; klienti, ktorých vlastní koreň praxe
 * (jeden priečinok pre všetko, neregistrovaný klient), dostanú chat v koreni s priečinkom klienta. Bez praxe sú
 * na výber všetky projekty klientov. Prázdny zoznam = natívne správanie.
 */
export function newChatChoices(
  workspaces: readonly Pick<RouteWorkspace, "id" | "path" | "name" | "displayNameResolved">[],
  model: Pick<ClientNavModel, "clients" | "hidden" | "practiceRootId">,
  rootClients: readonly { key: string; title: string; folder: string }[] = [],
): NewChatTarget[] {
  const rootId = model.practiceRootId;
  const projects: NewChatTarget[] = workspaces
    .filter((w) => model.clients.has(w.id) && !model.hidden.has(w.id) && w.id !== rootId)
    .map((w) => ({ id: w.id, workspaceId: w.id, root: w.path, title: w.displayNameResolved || w.name || w.path }));
  const folders: NewChatTarget[] = rootId && !model.hidden.has(rootId)
    ? rootClients.map((c) => ({ id: `${rootId}\u0000${c.key}`, key: c.key, workspaceId: rootId, folder: c.folder, root: c.folder, title: c.title }))
    : [];
  return [...projects, ...folders].sort((a, b) => a.title.localeCompare(b.title, "cs") || a.id.localeCompare(b.id));
}

/** Trasa prešla do projektu: jeho zatvorenie Prípadov používateľom sa zabudne (ako prepnutie uzla pri jednom klientovi). */
export function forgetProjectOverride(overrides: Readonly<Record<string, boolean>>, focused: string | null): Readonly<Record<string, boolean>> {
  if (!focused || !(focused in overrides)) return overrides;
  return Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== focused));
}

/** Čo urobí „Nový chat“ bez otvoreného projektu: natívne správanie (Pokročilý, žiadny klient), rovno jediný klient, alebo výber. */
export type NewChatAction = { kind: "native" } | { kind: "create"; target: NewChatTarget } | { kind: "pick" } | { kind: "refuse" };
/**
 * `context`: klient z trasy (detail prípadu `?vec=`, prehľad klienta `?klient=`, chat v priečinku klienta). Tieto
 * stránky nemajú otvorený projekt, preto sa kontext trasy uplatní aj tu: chat rovno u toho klienta, bez výberu.
 */
export function newChatAction(mode: "lite" | "pro", choices: readonly NewChatTarget[], context?: NewChatTarget): NewChatAction {
  if (mode !== "lite" || choices.length === 0) return { kind: "native" };
  if (context) return { kind: "create", target: context };
  return choices.length === 1 ? { kind: "create", target: choices[0] } : { kind: "pick" };
}

/**
 * Voľba „Nového chatu“ pre klienta z kontextu trasy: klient v koreni praxe podľa kľúča skupiny, registrovaný
 * klient podľa projektu, ktorý jeho skupinu vlastní. Neznámy kľúč alebo klient mimo volieb = žiadna.
 */
export function contextChoice(choices: readonly NewChatTarget[], contextKey: string | undefined, ownerOf: ReadonlyMap<string, string>): NewChatTarget | undefined {
  if (!contextKey) return undefined;
  const byKey = choices.find((c) => c.key === contextKey);
  if (byKey) return byKey;
  const owner = ownerOf.get(contextKey);
  return owner ? choices.find((c) => c.folder === undefined && c.workspaceId === owner) : undefined;
}

/**
 * „Nový chat“ v otvorenom projekte (bežný režim): v koreni praxe s klientmi z OKF nikdy nad celým koreňom
 * (rozhodnutie MČ 19. 10. 2026). Kontext trasy (chat v priečinku klienta, vec, prehľad klienta) založí chat
 * u toho klienta, inak výber klientov koreňa. `null` = obyčajný projekt alebo Pokročilý režim: natívne.
 */
/**
 * Stav čítania pre „Nový chat“ v otvorenom projekte: `pending` = prehľad sa číta, `rootUnknown` = profil onboardingu
 * (koreň praxe) sa ešte číta, `incomplete` = prehľad je neúplný (orezaný alebo s problémami), `failed` = nedostupný.
 */
export type ProjectChatRead = { pending?: boolean; rootUnknown?: boolean; incomplete?: boolean; failed?: boolean };

export function projectNewChatAction(mode: "lite" | "pro", openProjectId: string, rootId: string | null, rootTargets: readonly NewChatTarget[], contextKey?: string, read: ProjectChatRead = {}): NewChatAction | null {
  if (mode !== "lite") return null;
  // Profil sa ešte číta: otvorený projekt môže byť koreň praxe, výber počká (nie natívny chat nad celou praxou).
  if (read.rootUnknown) return { kind: "pick" };
  if (openProjectId !== rootId) return null;
  if (rootTargets.length === 0) {
    // R1(a): prehľad koreňa sa ešte číta → výber s čakaním. Neúplný alebo nedostupný prehľad nedokladá, že koreň
    // nemá klientov: odmietnutie, nie natívny chat nad celou praxou. Úplný prehľad bez klientov = obyčajný projekt.
    if (read.pending) return { kind: "pick" };
    return read.incomplete || read.failed ? { kind: "refuse" } : null;
  }
  const target = contextKey ? rootTargets.find((t) => t.key === contextKey) : undefined;
  if (target) return { kind: "create", target };
  return rootTargets.length === 1 ? { kind: "create", target: rootTargets[0] } : { kind: "pick" };
}

/**
 * Výber otvorený počas čítania profilu alebo prehľadu koreňa (R1(a)), keď čítanie skončí: projekt nie je koreň =
 * natívny chat; klienti sú = výber; úplný prehľad bez klientov z OKF = obyčajný projekt, natívny chat v ňom;
 * neúplný alebo nedostupný prehľad = nič sa nezaloží (odmietnutie).
 */
export function settleRootPicker(read: ProjectChatRead & { isRoot: boolean; rootTargets: number }): "wait" | "pick" | "native" | "refuse" {
  if (read.pending || read.rootUnknown) return "wait";
  // Profil dočítaný a otvorený projekt nie je koreň praxe: natívny chat v ňom.
  if (!read.isRoot) return "native";
  if (read.rootTargets > 0) return "pick";
  return read.failed || read.incomplete ? "refuse" : "native";
}

/**
 * Číta sa ešte niečo, na čo „Nový chat“ čaká: spojenie, koreň praxe (s kotvou) alebo prehľad známeho rozsahu.
 * Bez rozsahu (žiadny priečinok, teda nič na čítanie) a po chybe sa nečaká, inak by výber s čakaním nezavrel.
 */
export function clientNavPending(state: { connectionLoading: boolean; failed: boolean; scopePending: boolean; scope: boolean; data: boolean }): boolean {
  return !state.failed && (state.connectionLoading || state.scopePending || (state.scope && !state.data));
}
