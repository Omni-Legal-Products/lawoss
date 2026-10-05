/**
 * Ktorý OKF klient patrí k otvorenému pracovnému priestoru. Číta len koreň priečinka cez súborové
 * API servera (žiadna úplná kontrola stromu): karta klienta v koreni znamená klienta; karta veci
 * alebo subjektu znamená, že klient je najbližší nadradený zaregistrovaný pracovný priestor s kartou
 * klienta. Nič nezapisuje; pravdivosť overí server pri zápise (profil onboardingu, plán veci).
 */
import type { LegalworkServerClient, LegalworkWorkspaceInfo } from "@/app/lib/legalwork-server";
import { parseFrontmatter } from "../../../../../lawoss/okf/src/frontmatter";

export type OpenClientReader = Pick<LegalworkServerClient, "listWorkspaceDirectory" | "readWorkspaceFile">;
export type OpenClientWorkspace = Pick<LegalworkWorkspaceInfo, "id" | "path" | "name" | "displayName" | "workspaceType">;
/** `workspaceId` je pracovný priestor klienta, do ktorého patria aj jeho skilly. */
export type OpenClient = { workspaceId: string; root: string; title: string };

const CLIENT_CARDS = ["client.md", "klient.md"];
const ENTITY_CARDS = ["matter.md", "spis.md", "project.md", "projekt.md", "subject.md"];

const slashed = (path: string): string => path.replaceAll("\\", "/").replace(/\/+$/, "");
const baseName = (path: string): string => slashed(path).split("/").pop() ?? path;
const isLocal = (workspace: OpenClientWorkspace): boolean => workspace.workspaceType !== "remote" && Boolean(workspace.path);
const fallbackTitle = (workspace: OpenClientWorkspace): string =>
  workspace.displayName?.trim() || workspace.name?.trim() || baseName(workspace.path);

async function rootFiles(reader: OpenClientReader, workspace: OpenClientWorkspace): Promise<string[]> {
  const listing = await reader.listWorkspaceDirectory(workspace.id, "");
  return listing.entries.filter((entry) => entry.kind === "file").map((entry) => entry.name);
}

/** Klient s kartou v koreni pracovného priestoru; názov z karty (`title:`), inak názov priestoru. */
async function clientAt(reader: OpenClientReader, workspace: OpenClientWorkspace, files: readonly string[]): Promise<OpenClient | null> {
  const card = CLIENT_CARDS.find((name) => files.includes(name));
  if (!card) return null;
  const title = await reader.readWorkspaceFile(workspace.id, card)
    .then((file) => parseFrontmatter(file.content)?.title?.trim())
    .catch(() => undefined);
  return { workspaceId: workspace.id, root: workspace.path, title: title || fallbackTitle(workspace) };
}

/**
 * OKF klient otvoreného pracovného priestoru alebo `null`. Vec či subjekt otvorený ako samostatný
 * priestor nájde klienta len medzi zaregistrovanými nadradenými priestormi; mimo nich nehádame.
 */
export async function resolveOpenClient(
  reader: OpenClientReader,
  workspaces: readonly OpenClientWorkspace[],
  workspaceId: string | null | undefined,
): Promise<OpenClient | null> {
  const open = workspaces.find((workspace) => workspace.id === workspaceId);
  if (!open || !isLocal(open)) return null;
  try {
    const files = await rootFiles(reader, open);
    const own = await clientAt(reader, open, files);
    if (own || !ENTITY_CARDS.some((name) => files.includes(name))) return own;
    const path = slashed(open.path);
    const ancestors = workspaces
      .filter((candidate) => candidate.id !== open.id && isLocal(candidate) && path.startsWith(`${slashed(candidate.path)}/`))
      .sort((a, b) => slashed(b.path).length - slashed(a.path).length);
    for (const ancestor of ancestors) {
      const client = await clientAt(reader, ancestor, await rootFiles(reader, ancestor).catch(() => []));
      if (client) return client;
    }
  } catch {
    // Nečitateľný priečinok nie je chyba používateľa; formulár aj skilly ostanú pri pôvodnom správaní.
  }
  return null;
}

/** Meno klienta pre zobrazenie: zaregistrovaný priestor s rovnakou cestou a jeho karta, inak názov priečinka. */
export async function clientTitleOf(
  reader: OpenClientReader,
  workspaces: readonly OpenClientWorkspace[],
  root: string,
): Promise<string> {
  const workspace = workspaces.find((candidate) => isLocal(candidate) && slashed(candidate.path) === slashed(root));
  if (!workspace) return baseName(root);
  const client = await clientAt(reader, workspace, await rootFiles(reader, workspace).catch(() => [])).catch(() => null);
  return client?.title ?? fallbackTitle(workspace);
}
