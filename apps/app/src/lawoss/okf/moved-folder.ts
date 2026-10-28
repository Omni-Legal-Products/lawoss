/**
 * „Nájsť presunutý priečinok“ (N-A7-1, test A10, 28. 10. 2026): po premenovaní alebo presune praxe či klienta
 * appka existujúcich klientov prepojí na nové miesto (rovnaké id, chaty a nastavenia), nepridá ich znova.
 * Server (`/lawoss/onboarding/moved-folder`) spozná klientov a nič nezapisuje; prepojenie ide existujúcim
 * `reconnectWorkspace`, až keď advokát náhľad potvrdí. Bez Reactu, aby sa dalo testovať.
 */
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";

export type MovedFolderApiPath = "moved-folder" | "moved-practice";
export type MovedFolderRef = { workspaceId: string; name: string };
export type MovedFolderMatch = MovedFolderRef & { expectedPath: string; folderPath: string };
export type MovedFolderPreview = { kind: "practice" | "client"; previousRoot: string; folderPath: string; matches: MovedFolderMatch[]; notFound: MovedFolderRef[] };
/** Čo prepojenie potrebuje od klienta servera; výsledky volaní nečíta. */
export type MovedFolderClient = {
  reconnectWorkspace(workspaceId: string, payload: { folderPath: string; expectedPath: string }): Promise<unknown>;
  lawossMovedFolder(path: MovedFolderApiPath, body: unknown): Promise<unknown>;
};
export type MovedFolderOutcome = { reconnected: MovedFolderMatch[]; failed: MovedFolderRef[] };

/** Náhľad: ktorých chýbajúcich klientov server vo vybranom priečinku spoznal. Nič nezapisuje. */
export function previewMovedFolder(client: Pick<LegalworkServerClient, "lawossMovedFolder">, workspaceId: string, folderPath: string): Promise<MovedFolderPreview> {
  return client.lawossMovedFolder<MovedFolderPreview>("moved-folder", { workspaceId, folderPath });
}

/**
 * Po potvrdení prepojí spoznaných klientov jedného po druhom; zlyhanie jedného ostatných nezastaví. Pri praxi
 * potom presunie prax v profile a povolenie pamäte kancelárie; ak to zlyhá, prax ostane neprepojená (`failed`).
 */
export async function reconnectMovedFolder(client: MovedFolderClient, preview: MovedFolderPreview): Promise<MovedFolderOutcome> {
  const reconnected: MovedFolderMatch[] = [];
  const failed: MovedFolderRef[] = [];
  for (const match of preview.matches) {
    try {
      await client.reconnectWorkspace(match.workspaceId, { folderPath: match.folderPath, expectedPath: match.expectedPath });
      reconnected.push(match);
    } catch (error) {
      console.warn("LAWOSS: prepojenie presunutého priečinka", error);
      failed.push({ workspaceId: match.workspaceId, name: match.name });
    }
  }
  if (preview.kind === "practice" && reconnected.length) {
    try {
      await client.lawossMovedFolder("moved-practice", { previousRoot: preview.previousRoot, folderPath: preview.folderPath });
    } catch (error) {
      console.warn("LAWOSS: presun praxe v profile", error);
      failed.push({ workspaceId: "", name: lastSegment(preview.folderPath) });
    }
  }
  return { reconnected, failed };
}

/** Zoznam priestorov s novými cestami prepojených klientov (aktivácia beží skôr, než sa zoznam načíta znova). */
export function withReconnectedPaths<W extends { id: string; path: string }>(workspaces: readonly W[], reconnected: readonly MovedFolderMatch[]): W[] {
  return workspaces.map((workspace) => {
    const match = reconnected.find((item) => item.workspaceId === workspace.id);
    return match ? { ...workspace, path: match.folderPath } : workspace;
  });
}

export const lastSegment = (path: string): string => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
