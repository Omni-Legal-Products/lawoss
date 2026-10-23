/**
 * Súbory prípadu v rozsahu prehľadu (alfa2 C2): otvorenie zdroja a oprava typu prehľadu.
 * Cesta sa smie použiť len vtedy, keď leží v priečinku klienta, ktorému prípad patrí — nikdy
 * v inom klientovi praxe ani v kancelárii (AGENTS: „never fall back to another client“).
 */
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { isOfficeFile } from "../../../../../lawoss/okf/read";
import { setCardViewTags, type ViewFamily } from "../../../../../lawoss/okf/views";
import { locateInScope, type OkfScope } from "../okf/read-model";

/** Súbor prehľadu → cesta v priečinku klienta `workspaceId`; priečinok, kancelária alebo iný klient → `null`. */
export function locateCaseFile(scope: OkfScope | null, file: string, workspaceId: string): { workspace: RouteWorkspace; path: string } | null {
  if (!scope || !file || file.endsWith("/") || isOfficeFile(file)) return null;
  const located = locateInScope(scope, file);
  return located?.path && located.workspace.id === workspaceId ? located : null;
}

type CardClient = Pick<LegalworkServerClient, "readWorkspaceFile" | "writeWorkspaceFile">;

/** Čerstvý text karty prípadu pre náhľad opravy typu. */
export async function loadCaseCard(scope: OkfScope | null, workspaceId: string, cardPath: string, client: Pick<LegalworkServerClient, "readWorkspaceFile">): Promise<string> {
  const card = locateCaseFile(scope, cardPath, workspaceId);
  if (!card) throw new Error("card_outside_client");
  return (await client.readWorkspaceFile(card.workspace.id, card.path)).content;
}

/**
 * Zapíše opravený typ prehľadu: iba riadok `tags:` z presne toho textu, ktorý ukázal náhľad (`before`),
 * s kontrolou na serveri, že sa karta medzitým nezmenila (`expectedContent`; inak 409 a nič sa nezapíše).
 * `revalidate` znovu overí rozsah a čerstvé čítanie klienta; iný priečinok sa odmietne.
 */
export async function saveCaseViewTags(input: {
  scope: OkfScope | null; workspaceId: string; cardPath: string; before: string; families: ViewFamily[] | null;
  revalidate: () => Promise<{ connection: { client: CardClient }; workspace: { id: string } }>;
}): Promise<void> {
  const card = locateCaseFile(input.scope, input.cardPath, input.workspaceId);
  if (!card) throw new Error("card_outside_client");
  const content = setCardViewTags(input.before, input.families);
  if (content === input.before) return;
  const current = await input.revalidate();
  if (current.workspace.id !== input.workspaceId) throw new Error("card_outside_client");
  await current.connection.client.writeWorkspaceFile(current.workspace.id, { path: card.path, content, expectedContent: input.before });
}
