/**
 * N-A7-14 (test E2, 28. 10. 2026): v chate klienta C001 agent žiadal `external_directory` s rozsahom `…/Klienti/C002*` (vzor s lomkou a hviezdičkou na konci)
 * a karta „Pristúpiť k externému priečinku?“ nepovedala, že ide o priečinok iného klienta tej istej praxe.
 *
 * Registrovaného iného klienta odmietne už plugin enginu `lawoss-linked-folders` (`externalDirectoryOtherClient`
 * na serveri), karta sa preto ukáže len vtedy, keď plugin nerozhodne (napr. firemné pravidlá, nečitateľná mapa,
 * priečinok, ktorý klientov len obsahuje). Táto veta je pre ten prípad: karta povie meno klienta z bočného panela.
 * Iba zobrazenie, o prístupe nerozhoduje.
 */
import { t } from "@/i18n";
import type { PendingPermission } from "@/app/types";
import { clientCardLabel } from "./client-titles";
import { useClientNav } from "./client-nav";
import { comparable, within } from "./matter-conversations";

type ClientWorkspace = { id: string; path?: string | null; displayNameResolved?: string | null; displayName?: string | null; name?: string | null; workspaceType?: string | null; preset?: string | null };
export type OtherClientFolder = { kind: "inside"; name: string } | { kind: "contains"; names: string[] };

const GLOB = /[*?]/;
const segments = (path: string): string[] => path.split("/").filter(Boolean);
const segmentPattern = (segment: string): RegExp =>
  new RegExp(`^${segment.replace(/[.+^$|()[\]{}\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "isu");

/** Priečinok vzoru otázky (`<priečinok>/*`, ako `patternDirectory` na serveri); iný tvar `null`. */
function patternFolder(pattern: string): string | null {
  if (!/[\\/]\*$/.test(pattern)) return null;
  return comparable(pattern.slice(0, -2).replace(/\\/g, "/") || "/");
}

/** Rozvinie sa vzor (s `*`/`?`) na `root` alebo priečinok v ňom? Po segmentoch, `**` pokryje všetko pod sebou. */
function reaches(pattern: string, root: string): boolean {
  const wanted = segments(pattern), parts = segments(root);
  for (let index = 0; index < parts.length; index++) {
    const segment = wanted[index];
    if (segment === undefined) return false;
    if (segment === "**") return true;
    if (GLOB.test(segment) ? !segmentPattern(segment).test(parts[index]!) : segment.toLowerCase() !== parts[index]!.toLowerCase()) return false;
  }
  return true;
}

const label = (workspace: ClientWorkspace): string => {
  const native = workspace.displayNameResolved?.trim() || workspace.displayName?.trim() || workspace.name?.trim() || "";
  return clientCardLabel(workspace.id, native, workspace.path) ?? native;
};

/**
 * Patrí rozsah otázky inému klientovi ako klient chatu? `inside`: cieľ leží v inom klientovi alebo sa vzor naň rozvinie;
 * `contains`: cieľ iných klientov obsahuje (napr. priečinok „Klienti“). Klient chatu je najhlbší priečinok, v ktorom
 * chat leží; priečinok, ktorý ho obsahuje (kontajner praxe), nie je iný klient. Chat kontajnera (obsahuje iných) sa nerieši.
 */
export function otherClientFolder(patterns: readonly string[], chatDirectory: string | null | undefined, workspaces: readonly ClientWorkspace[]): OtherClientFolder | null {
  if (!chatDirectory?.trim()) return null;
  const chat = comparable(chatDirectory);
  const clients = workspaces.flatMap((workspace) => workspace.path && workspace.workspaceType !== "remote" && workspace.preset !== "wiki" ? [{ workspace, root: comparable(workspace.path) }] : []);
  const owner = [...clients].sort((a, b) => b.root.length - a.root.length).find((client) => within(client.root, chat));
  if (!owner || clients.some((client) => client !== owner && within(owner.root, client.root) && client.root !== owner.root)) return null;
  const others = clients.filter((client) => client.root !== owner.root && !within(client.root, owner.root));
  const contained = new Set<string>();
  for (const pattern of patterns) {
    const folder = patternFolder(pattern);
    if (!folder) continue;
    const hit = GLOB.test(folder)
      ? others.find((client) => reaches(folder, client.root))
      : [...clients].sort((a, b) => b.root.length - a.root.length).find((client) => within(client.root, folder));
    if (hit && others.includes(hit)) return { kind: "inside", name: label(hit.workspace) };
    if (!GLOB.test(folder)) for (const client of others) if (within(folder, client.root)) contained.add(label(client.workspace));
  }
  return contained.size ? { kind: "contains", names: [...contained] } : null;
}

/** Veta karty: meno iného klienta, alebo až tri mená klientov, ktorých priečinky cieľ obsahuje. */
export function otherClientFolderText(found: OtherClientFolder | null): string | null {
  if (!found) return null;
  const shown = found.kind === "inside" ? found.name : found.names.slice(0, 3).join(", ") + (found.names.length > 3 ? ` +${found.names.length - 3}` : "");
  const text = found.kind === "inside" ? t("lawoss.permission_card.other_client", undefined, { name: shown }) : t("lawoss.permission_card.other_clients_inside", undefined, { names: shown });
  // Meno končiace bodkou („a. s.“) bez druhej bodky za ním.
  return shown.endsWith(".") ? text.replace(`${shown}.`, shown) : text;
}

/** Pre kartu `external_directory`: veta o inom klientovi podľa klientov z bočného panela; inak `null`. */
export function useOtherClientFolderText(permission: Pick<PendingPermission, "permission" | "patterns">, chatDirectory: string | null | undefined): string | null {
  const nav = useClientNav();
  if (permission.permission !== "external_directory") return null;
  return otherClientFolderText(otherClientFolder(permission.patterns, chatDirectory, nav?.connection?.workspaces ?? []));
}
