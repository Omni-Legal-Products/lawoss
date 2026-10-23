/**
 * LAWOSS: cesty nástroja `lawoss_files` (N-A2-1, 23. 10. 2026). Relatívna cesta platí od priečinka chatu;
 * chat prípadu beží v podpriečinku prípadu (`…/Spisy/M001`). Model však často opíše cestu od koreňa
 * klienta, ktorú vidí v pamäti a zoznamoch („Spisy/M001/01_Podklady/…“), a zložená s priečinkom chatu
 * by sa zdvojila („Spisy/M001/Spisy/M001/…“). Cesta, ktorá začína priečinkom chatu voči koreňu klienta,
 * sa preto berie od koreňa klienta. Hranicu (koreň klienta, pripojené priečinky) overuje ďalej server.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";

const inside = (root: string, directory: string): boolean => {
  const path = relative(resolve(root), resolve(directory));
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
};

/** Najbližší registrovaný priečinok klienta, v ktorom chat beží (rovnaké pravidlo ako `resolveWorkspaceId`). */
export function chatWorkspace<T extends { id: string; path: string }>(workspaces: readonly T[], directory: string): T | undefined {
  return [...workspaces].filter((item) => item.path && inside(item.path, directory)).sort((a, b) => b.path.length - a.path.length)[0];
}

/** Absolútna cesta pre server: od priečinka chatu, alebo od koreňa klienta, ak už začína priečinkom chatu. */
export function chatFilePath(value: string, directory: string, clientRoot: string): string {
  if (isAbsolute(value)) return value;
  const chat = relative(resolve(clientRoot), resolve(directory)).split(sep).join("/");
  const written = value.split(/[\\/]+/).filter((part) => part && part !== ".").join("/");
  if (chat && !chat.startsWith("..") && (written === chat || written.startsWith(`${chat}/`))) return resolve(clientRoot, value);
  return resolve(directory, value);
}
