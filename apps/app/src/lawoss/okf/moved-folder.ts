/**
 * „Nájsť presunutý priečinok“ (N-A7-1, test A10, 28. 10. 2026): po premenovaní alebo presune praxe či klienta
 * appka existujúcich klientov prepojí na nové miesto (rovnaké id, chaty a nastavenia), nepridá ich znova.
 * Server (`/lawoss/onboarding/moved-folder`) spozná klientov a nič nezapisuje; prepojenie ide existujúcim
 * `reconnectWorkspace`, až keď advokát náhľad potvrdí. Bez Reactu, aby sa dalo testovať.
 */
import { LegalworkServerError, type LegalworkServerClient } from "@/app/lib/legalwork-server";

export type MovedFolderApiPath = "moved-folder" | "moved-practice" | "reconnected";
export type MovedFolderRef = { workspaceId: string; name: string };
/** `marker`: priečinok nesie značku LAWOSS s pôvodnou cestou klienta; `name`: zhoduje sa len meno (môže to byť iný klient). */
export type MovedFolderEvidence = "marker" | "name";
export type MovedFolderMatch = MovedFolderRef & { expectedPath: string; folderPath: string; evidence: MovedFolderEvidence };
/** Otázka „Je to ten istý klient?“ pri „Pridať klienta“ (`onboarding_client_moved`). */
export type MovedClientChoice = MovedFolderMatch;
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

/** Po prepojení klienta presunie povolenie pamäte kancelárie (server); zlyhanie dobehne pri dokončení presunu praxe. */
async function afterReconnect(client: MovedFolderClient, workspaceId: string): Promise<void> {
  try { await client.lawossMovedFolder("reconnected", { workspaceId }); }
  catch (error) { console.warn("LAWOSS: povolenie kancelárie po prepojení", error); }
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
      await afterReconnect(client, match.workspaceId);
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

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const text = (value: unknown): string | undefined => typeof value === "string" && value ? value : undefined;

/** Odpoveď servera „tento priečinok môže byť presunutý zaregistrovaný klient“; iné chyby `undefined`. */
export function movedClientChoice(error: unknown): MovedClientChoice | undefined {
  if (!(error instanceof LegalworkServerError) || error.code !== "onboarding_client_moved" || !isRecord(error.details)) return undefined;
  const { workspaceId, name, expectedPath, folderPath, evidence } = error.details;
  const fields = { workspaceId: text(workspaceId), name: text(name), expectedPath: text(expectedPath), folderPath: text(folderPath) };
  if (!fields.workspaceId || !fields.name || !fields.expectedPath || !fields.folderPath) return undefined;
  return { workspaceId: fields.workspaceId, name: fields.name, expectedPath: fields.expectedPath, folderPath: fields.folderPath, evidence: evidence === "marker" ? "marker" : "name" };
}

/** „Prepojiť“ pri otázke „Je to ten istý klient?“: zaregistrovaný klient dostane tento priečinok (rovnaké id). */
export async function linkMovedClient(client: MovedFolderClient, choice: MovedClientChoice): Promise<{ id: string; path: string; name: string }> {
  await client.reconnectWorkspace(choice.workspaceId, { folderPath: choice.folderPath, expectedPath: choice.expectedPath });
  await afterReconnect(client, choice.workspaceId);
  return { id: choice.workspaceId, path: choice.folderPath, name: choice.name };
}

/** Zoznam priestorov s novými cestami prepojených klientov (aktivácia beží skôr, než sa zoznam načíta znova). */
export function withReconnectedPaths<W extends { id: string; path: string }>(workspaces: readonly W[], reconnected: readonly MovedFolderMatch[]): W[] {
  return workspaces.map((workspace) => {
    const match = reconnected.find((item) => item.workspaceId === workspace.id);
    return match ? { ...workspace, path: match.folderPath } : workspace;
  });
}

export const lastSegment = (path: string): string => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
