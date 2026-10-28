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
 *
 * Agent o pripojených priečinkoch vie z pripomienky (alfa2 A3, N-18): zoznam pripojených priečinkov klienta chatu
 * (aj chatu prípadu) ide ako `<system-reminder topic="linked-folders">` do konverzácie, nie do systémového promptu
 * (AGENTS.md „Prompt caching“). Iní klienti a ich priečinky sa v nej nikdy neobjavia.
 */
// Exportovaný je len vstupný bod pluginu: OpenCode volá každý export modulu.
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { allowedFolders, canonicalPath, externalDirectoryAllowed, LINKED_FOLDERS_MAP_FILE, ownerOf, parseLinkedFoldersMap, patternDirectory } from "../lawoss/linked-folders-rules.js";
import { appStateReminders, type SavedConversations } from "./app-state-reminders.js";

type ReplyOptions = { path: { id: string; permissionID: string }; body: { response: "once" }; query?: { directory?: string } };
type SessionGet = (options: { path: { id: string }; query?: { directory?: string } }) => Promise<{ data?: unknown }>;
type SessionMessages = NonNullable<NonNullable<SavedConversations["client"]>["session"]>["messages"];
type PluginInput = { directory?: string; client?: { postSessionIdPermissionsPermissionId?: (options: ReplyOptions) => Promise<unknown>; session?: { get?: SessionGet; messages?: SessionMessages } } };
type BusEvent = { type?: string; properties?: unknown };

type Asked = { id: string; sessionID: string; permission: string; patterns: string[] };

function asked(properties: unknown): Asked | null {
  if (!properties || typeof properties !== "object") return null;
  const { id, sessionID, permission, patterns }: Record<string, unknown> = Object.fromEntries(Object.entries(properties));
  if (typeof id !== "string" || typeof sessionID !== "string" || typeof permission !== "string") return null;
  if (!Array.isArray(patterns) || !patterns.every((pattern) => typeof pattern === "string")) return null;
  return { id, sessionID, permission, patterns };
}

/** Mapa od servera a priečinok, v ktorom leží (dáta aplikácie: nikdy sa nepovolia). */
async function readMap() {
  const config = process.env.OPENCODE_CONFIG?.trim();
  if (!config) return null;
  try {
    const map = parseLinkedFoldersMap(JSON.parse(await readFile(join(dirname(config), LINKED_FOLDERS_MAP_FILE), "utf8")));
    return map ? { map, appData: await canonicalPath(dirname(config)) } : null;
  } catch {
    return null;
  }
}

/** Chat otázky patrí tejto inštancii (jej priečinok), inak plugin nerozhoduje. */
async function sessionInDirectory(input: PluginInput, sessionID: string, directory: string): Promise<boolean> {
  const get = input.client?.session?.get;
  if (!get) return false;
  const { data } = await get.call(input.client?.session, { path: { id: sessionID }, query: { directory } });
  const sessionDirectory = data && typeof data === "object" && "directory" in data && typeof data.directory === "string" ? data.directory : null;
  return sessionDirectory !== null && await canonicalPath(sessionDirectory) === await canonicalPath(directory);
}

/** Rozhodnutie pre jednu otázku; `true` = odpovedať „once“. Výnimka = nerozhodovať. Neexportuje sa: engine volá každý export. */
async function linkedFolderDecision(directory: string, request: Asked): Promise<boolean> {
  if (request.permission !== "external_directory") return false;
  const read = await readMap();
  if (!read) return false;
  const targets = await Promise.all(request.patterns.map((pattern) => {
    const folder = patternDirectory(pattern);
    return folder ? canonicalPath(folder) : null;
  }));
  return externalDirectoryAllowed(read.map, await canonicalPath(directory), targets, [read.appData]);
}

/** Pevná veta systémového promptu (nemení sa počas konverzácie). */
const LINKED_FOLDERS_SYSTEM = "A linked-folders reminder, when present, lists folders the user linked to this client. They belong to this client: read them like the client's own folder, without asking, and pass absolute file paths from them to lawoss_documents_prepare. Never use folders of other clients.";

/** Pripojené priečinky klienta tohto chatu ako text pripomienky; "" bez nich, `null` pri nečitateľnej mape. */
async function linkedFoldersState(directory: string | undefined): Promise<string | null> {
  if (!directory) return "";
  const read = await readMap();
  if (!read) return null;
  const chat = await canonicalPath(directory);
  const owner = ownerOf(read.map, chat);
  const folders = allowedFolders(read.map, chat, [read.appData]).filter((folder) => folder !== owner?.root);
  if (folders.length === 0) return "";
  return [
    "Linked folders of this client (linked by the user; they belong to this client, also in its cases' chats).",
    "Read and list them without asking, like the client's own folder. For PDF, EML, Office or scanned files call lawoss_documents_prepare with the absolute file path, then lawoss_documents_list and lawoss_documents_read. Only read; change files there only when the user asks.",
    // N-A7-5: glob bez `path` hľadá len v priečinku chatu (v chate prípadu len v prípade), legalwork_review_files len v klientovi;
    // pripojené priečinky nepokrýva ani jeden. Priečinok sa nepripravuje.
    "glob without a path searches only this chat's folder, and legalwork_review_files only this client's folder; neither covers linked folders. To find a file in a linked folder, run glob with that folder's absolute path as path. lawoss_documents_prepare takes file paths only, never a folder.",
    ...folders.map((folder) => `- ${basename(folder)}: ${folder}`),
  ].join("\n");
}

export const LawossLinkedFolders = async (input: PluginInput) => {
  const saved: SavedConversations = { directory: input.directory, client: input.client?.session?.messages ? { session: { messages: input.client.session.messages.bind(input.client.session) } } : undefined };
  const reminders = appStateReminders("linked-folders", () => linkedFoldersState(input.directory), "This client has no linked folders any more.", saved);
  return ({
  "chat.message": reminders.userMessage,
  "tool.execute.after": reminders.toolResult,
  "experimental.chat.system.transform": async (_input: unknown, output: { system: string[] }) => { output.system.push(LINKED_FOLDERS_SYSTEM); },
  event: async ({ event }: { event: BusEvent }) => {
    reminders.event({ event: { type: event.type ?? "", properties: event.properties } });
    if (event.type !== "permission.asked" || !input.directory) return;
    const request = asked(event.properties);
    const reply = input.client?.postSessionIdPermissionsPermissionId;
    if (!request || !reply) return;
    try {
      if (!(await linkedFolderDecision(input.directory, request))) return;
      if (!(await sessionInDirectory(input, request.sessionID, input.directory))) return;
      await reply.call(input.client, { path: { id: request.sessionID, permissionID: request.id }, body: { response: "once" }, query: { directory: input.directory } });
    } catch {
      // Bez rozhodnutia ostane bežná otázka používateľovi.
    }
  },
  });
};
