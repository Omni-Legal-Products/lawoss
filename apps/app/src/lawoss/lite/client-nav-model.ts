/**
 * Prípady pod natívnym projektom: ktoré uzly stromu patria projektu, kedy sú Prípady otvorené,
 * čo robí klik na ne a ktorí klienti sa nečítajú, kým sú Prípady zbalené. Čistý model bez Reactu.
 */
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import type { ClientChoice } from "./client-choice";
import type { ClientNavModel } from "./client-projects";
import { clientToggle, type TreeClient, type TreeFocus } from "./client-tree";
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
  const key = focus.client ?? groups.find((g) => g.matters.some((m) => m.path === focus.matter))?.key;
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

/**
 * Natívny „Nový chat“ v bežnom režime bez otvoreného projektu (rozhodnutie MČ 19. 10. 2026): klienti praxe
 * na výber, nikdy koreň praxe, keď sú aj iní klienti. Prázdny zoznam = natívne správanie.
 */
export function newChatChoices(workspaces: readonly Pick<RouteWorkspace, "id" | "path" | "name" | "displayNameResolved">[], model: Pick<ClientNavModel, "clients" | "hidden" | "practiceRootId">): ClientChoice[] {
  const clients = workspaces.filter((w) => model.clients.has(w.id) && !model.hidden.has(w.id));
  const withoutRoot = clients.filter((w) => w.id !== model.practiceRootId);
  return (withoutRoot.length > 0 ? withoutRoot : clients)
    .map((w) => ({ id: w.id, root: w.path, title: w.displayNameResolved || w.name || w.path }))
    .sort((a, b) => a.title.localeCompare(b.title, "cs") || a.id.localeCompare(b.id));
}

/** Trasa prešla do projektu: jeho zatvorenie Prípadov používateľom sa zabudne (ako prepnutie uzla pri jednom klientovi). */
export function forgetProjectOverride(overrides: Readonly<Record<string, boolean>>, focused: string | null): Readonly<Record<string, boolean>> {
  if (!focused || !(focused in overrides)) return overrides;
  return Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== focused));
}

/** Čo urobí „Nový chat“ bez otvoreného projektu: natívne správanie (Pokročilý, žiadny klient), rovno jediný klient, alebo výber. */
export type NewChatAction = { kind: "native" } | { kind: "create"; workspaceId: string } | { kind: "pick" };
export function newChatAction(mode: "lite" | "pro", choices: readonly Pick<ClientChoice, "id">[]): NewChatAction {
  if (mode !== "lite" || choices.length === 0) return { kind: "native" };
  return choices.length === 1 ? { kind: "create", workspaceId: choices[0].id } : { kind: "pick" };
}
