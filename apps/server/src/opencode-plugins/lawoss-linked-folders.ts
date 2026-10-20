/**
 * LAWOSS: pripojené priečinky klienta po chatoch (MČ 19. 10. 2026).
 *
 * Engine 1.18.29 nemá háčik `permission.ask`; o povolení `external_directory` rozhodne podľa spoločného
 * súboru, ktorý je jeden pre všetkých klientov. Preto v ňom priečinky klientov nie sú a engine sa spýta.
 * Tento plugin počúva udalosť `permission.asked` vo svojej inštancii (priečinok chatu) a odpovie „once“
 * len vtedy, keď každý cieľ leží v koreni klienta tohto chatu alebo v jeho pripojených priečinkoch
 * (mapa od servera vedľa `OPENCODE_CONFIG`, pravidlá v `lawoss/linked-folders-rules.ts`). Inak nerobí
 * nič a otázka ostane používateľovi. Keď konfigurácia povolí širšie (napr. všetko), engine sa nepýta
 * a plugin sa ani neozve.
 */
// Exportovaný je len vstupný bod pluginu: OpenCode volá každý export modulu.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalPath, externalDirectoryAllowed, LINKED_FOLDERS_MAP_FILE, parseLinkedFoldersMap, patternDirectory } from "../lawoss/linked-folders-rules.js";

type ReplyOptions = { path: { id: string; permissionID: string }; body: { response: "once" }; query?: { directory?: string } };
type PluginInput = { directory?: string; client?: { postSessionIdPermissionsPermissionId?: (options: ReplyOptions) => Promise<unknown> } };
type BusEvent = { type?: string; properties?: unknown };

type Asked = { id: string; sessionID: string; permission: string; patterns: string[] };

function asked(properties: unknown): Asked | null {
  if (!properties || typeof properties !== "object") return null;
  const { id, sessionID, permission, patterns }: Record<string, unknown> = Object.fromEntries(Object.entries(properties));
  if (typeof id !== "string" || typeof sessionID !== "string" || typeof permission !== "string") return null;
  if (!Array.isArray(patterns) || !patterns.every((pattern) => typeof pattern === "string")) return null;
  return { id, sessionID, permission, patterns };
}

async function readMap() {
  const config = process.env.OPENCODE_CONFIG?.trim();
  if (!config) return null;
  try {
    return parseLinkedFoldersMap(JSON.parse(await readFile(join(dirname(config), LINKED_FOLDERS_MAP_FILE), "utf8")));
  } catch {
    return null;
  }
}

/** Rozhodnutie pre jednu otázku; `true` = odpovedať „once“. Výnimka = nerozhodovať. Neexportuje sa: engine volá každý export. */
async function linkedFolderDecision(directory: string, request: Asked): Promise<boolean> {
  if (request.permission !== "external_directory") return false;
  const map = await readMap();
  if (!map) return false;
  const targets = await Promise.all(request.patterns.map((pattern) => {
    const folder = patternDirectory(pattern);
    return folder ? canonicalPath(folder) : null;
  }));
  return externalDirectoryAllowed(map, await canonicalPath(directory), targets);
}

export const LawossLinkedFolders = async (input: PluginInput) => ({
  event: async ({ event }: { event: BusEvent }) => {
    if (event.type !== "permission.asked" || !input.directory) return;
    const request = asked(event.properties);
    const reply = input.client?.postSessionIdPermissionsPermissionId;
    if (!request || !reply) return;
    try {
      if (!(await linkedFolderDecision(input.directory, request))) return;
      await reply.call(input.client, { path: { id: request.sessionID, permissionID: request.id }, body: { response: "once" }, query: { directory: input.directory } });
    } catch {
      // Bez rozhodnutia ostane bežná otázka používateľovi.
    }
  },
});
