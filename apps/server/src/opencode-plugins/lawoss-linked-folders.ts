/**
 * LAWOSS: pripojené priečinky klienta po chatoch (MČ 19. 10. 2026).
 *
 * Engine 1.18.29 nemá háčik `permission.ask`; o povolení `external_directory` rozhodne podľa spoločného
 * súboru, ktorý je jeden pre všetkých klientov. Preto v ňom priečinky klientov nie sú a engine sa spýta.
 * Tento plugin počúva udalosť `permission.asked` vo svojej inštancii (priečinok chatu) a odpovie „once“
 * len vtedy, keď každý cieľ leží v koreni klienta tohto chatu alebo v jeho pripojených priečinkoch
 * (mapa od servera vedľa `OPENCODE_CONFIG`, pravidlá v `lawoss/linked-folders-rules.ts`). Keď cieľ patrí
 * inému registrovanému klientovi alebo obsahuje priečinky iných klientov (`…/Klienti`, `…/Klienti/*`), nechá kartu
 * advokátovi a appka na nej výrazne varuje (N-A7-14, rozhodnutie MČ 31. 10. 2026: nič neobmedzovať navyše, prístup
 * k inému klientovi je vedomé rozhodnutie advokáta). Rozsah, ktorý sa nedá jednoznačne určiť, odmietne s vetou pre
 * agenta. Rozsah, ktorý advokát na karte v tomto chate už zamietol, odmietne znova bez karty (model inak ponúkal tú
 * istú kartu opakovane). V režime YOLO (príznak v mape) povolí chat agentovi bez karty všetko ostatné; kartu iného
 * klienta ukáže aj vtedy. Inak nerobí nič a otázka ostane používateľovi. Keď konfigurácia povolí širšie (napr.
 * všetko), engine sa nepýta a plugin sa ani neozve.
 *
 * Agent o pripojených priečinkoch vie z pripomienky (alfa2 A3, N-18): zoznam pripojených priečinkov klienta chatu
 * (aj chatu prípadu) ide ako `<system-reminder topic="linked-folders">` do konverzácie, nie do systémového promptu
 * (AGENTS.md „Prompt caching“). Iní klienti a ich priečinky sa v nej nikdy neobjavia.
 */
// Exportovaný je len vstupný bod pluginu: OpenCode volá každý export modulu.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { allowedFolders, canonicalPath, CHAT_AGENT, expandScope, externalDirectoryAllowed, externalDirectoryOtherClient, LINKED_FOLDERS_MAP_FILE, ownerOf, parseLinkedFoldersMap, patternDirectory, refusedEarlier } from "../lawoss/linked-folders-rules.js";
import { appStateReminders, type SavedConversations } from "./app-state-reminders.js";
import { APP_NAMES_SYSTEM } from "../lawoss/app-setting-names.js";

type ReplyOptions = { path: { id: string; permissionID: string }; body: { response: "once" | "reject" }; query?: { directory?: string } };
type ReplyResult = { error?: unknown; response?: { ok?: boolean } } | undefined;
/** Interný klient SDK v1 (v rovnakom procese ako engine); cez neho ide odmietnutie s vetou na trasu `/permission/{id}/reply`. */
type RawClient = { post?: (options: { url: string; path: { requestID: string }; body: { reply: "reject"; message: string }; query?: { directory?: string }; headers?: Record<string, string> }) => Promise<ReplyResult> };
type SessionGet = (options: { path: { id: string }; query?: { directory?: string } }) => Promise<{ data?: unknown }>;
type SessionMessages = NonNullable<NonNullable<SavedConversations["client"]>["session"]>["messages"];
type PluginInput = { directory?: string; client?: { postSessionIdPermissionsPermissionId?: (options: ReplyOptions) => Promise<unknown>; _client?: RawClient; session?: { get?: SessionGet; messages?: SessionMessages } } };
type ChatMessage = { message: { id: string; agent?: unknown }; parts: object[] };
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

type SessionInfo = { directory: string | null; parentID: string | null };
async function sessionInfo(input: PluginInput, sessionID: string, directory: string): Promise<SessionInfo | null> {
  const get = input.client?.session?.get;
  if (!get) return null;
  const { data } = await get.call(input.client?.session, { path: { id: sessionID }, query: { directory } });
  if (!data || typeof data !== "object") return null;
  return {
    directory: "directory" in data && typeof data.directory === "string" ? data.directory : null,
    parentID: "parentID" in data && typeof data.parentID === "string" && data.parentID ? data.parentID : null,
  };
}

/** Chat otázky patrí tejto inštancii (jej priečinok), inak plugin nerozhoduje. */
async function sessionInDirectory(info: SessionInfo | null, directory: string): Promise<boolean> {
  return info?.directory != null && await canonicalPath(info.directory) === await canonicalPath(directory);
}

/** Hlavný chat (chat podagenta patrí chatu, ktorý ho spustil): zamietnutie platí pre celý rozhovor. */
async function rootSession(input: PluginInput, sessionID: string, info: SessionInfo | null, directory: string): Promise<string> {
  let id = sessionID, parent = info?.parentID ?? null;
  for (let depth = 0; parent && depth < 8; depth++) {
    id = parent;
    parent = (await sessionInfo(input, id, directory).catch(() => null))?.parentID ?? null;
  }
  return id;
}

/**
 * „open“ = karta pre advokáta; `otherClient`: rozsah siaha na iného klienta (karta aj v YOLO), `yolo`: mapa hlási
 * režim YOLO (ostatné žiadosti chat agenta bez karty).
 */
type Decision = { kind: "once" } | { kind: "reject" } | { kind: "open"; targets: (string | null)[]; otherClient: boolean; yolo: boolean };

/** Rozhodnutie pre jednu otázku: „once“, odmietnutie (nejednoznačný rozsah) alebo „open“. `null` = nerozhodovať. Neexportuje sa: engine volá každý export. */
async function linkedFolderDecision(directory: string, request: Asked): Promise<Decision | null> {
  if (request.permission !== "external_directory") return null;
  // Rozsah sa najprv normalizuje (domov, alternatívy `{a,b}`); čo sa normalizovať nedá, nemá cieľ a odmietne sa.
  const folders = request.patterns.map((pattern) => {
    const folder = patternDirectory(pattern);
    return folder ? expandScope(folder, homedir()) : [null];
  });
  const ambiguous = folders.some((expanded) => expanded === null);
  const targets = await Promise.all(folders.flatMap((expanded) => expanded ?? [null]).map((folder) => folder ? canonicalPath(folder) : null));
  const read = await readMap();
  if (!read) return { kind: "open", targets, otherClient: false, yolo: false };
  const chat = await canonicalPath(directory);
  if (!ambiguous && externalDirectoryAllowed(read.map, chat, targets, [read.appData])) return { kind: "once" };
  const scope = externalDirectoryOtherClient(read.map, chat, targets, ambiguous);
  if (scope === "ambiguous") return { kind: "reject" };
  return { kind: "open", targets, otherClient: scope !== null, yolo: read.map.yolo === true };
}

/** Spoločný záver viet pre agenta (N-A8-2): agent nikdy neradí povoliť priečinok iného klienta ani zmeniť nastavenia. */
const NO_WIDENING = "Never advise the user to allow, authorize or link this folder or a folder above it, to change any setting or permission for it, or to give this chat access to another client.";

/**
 * Vety pre agenta pri odmietnutí (N-A7-14). Engine ich vráti ako výsledok nástroja a agent pokračuje; bez nich by
 * holé odmietnutie ukončilo odpoveď bez vysvetlenia. Žiadna cesta ani meno klienta v nich nie sú. Priečinok iného
 * klienta sa neodmieta (karta advokátovi); keď ho advokát zamietne, agent dostane zamietnutie enginu.
 */
const REFUSALS = {
  ambiguous: `LAWOSS refused this request: the folder path contains variables, commands or patterns that cannot be resolved to definite folders, so it cannot be checked against this client's folders. Nothing was read or listed. For a folder of this client, use its plain absolute path without variables, commands or patterns. If the user asked for it, tell them in one short sentence, in their language, that the folder could not be opened. ${NO_WIDENING}`,
  repeated: `LAWOSS refused this request without asking the user again: earlier in this chat the user already refused access to this folder. Nothing was read. Do not ask for this folder or a folder inside it again in this chat and do not try another way to reach it. Continue without it, or tell the user in one short sentence, in their language, that the folder was not opened because they refused it. ${NO_WIDENING}`,
} as const;

/** Odmietne otázku s vetou pre agenta; keď to engine nevie, holé odmietnutie (ako „Zamietnuť“ na karte). */
async function rejectWithMessage(input: PluginInput, request: Asked, directory: string, message: string): Promise<void> {
  const raw = input.client?._client;
  if (raw?.post) {
    const result = await raw.post.call(raw, { url: "/permission/{requestID}/reply", path: { requestID: request.id }, body: { reply: "reject", message }, query: { directory }, headers: { "Content-Type": "application/json" } }).catch(() => undefined);
    if (result && !result.error && result.response?.ok !== false) return;
  }
  await input.client?.postSessionIdPermissionsPermissionId?.call(input.client, { path: { id: request.sessionID, permissionID: request.id }, body: { response: "reject" }, query: { directory } });
}

/** `permission.replied` (engine 1.18.29: `sessionID`, `requestID`, `reply`). */
function replied(properties: unknown): { requestID: string; reply: string } | null {
  if (!properties || typeof properties !== "object") return null;
  const { requestID, permissionID, reply, response }: Record<string, unknown> = Object.fromEntries(Object.entries(properties));
  const id = typeof requestID === "string" ? requestID : typeof permissionID === "string" ? permissionID : null;
  const answer = typeof reply === "string" ? reply : typeof response === "string" ? response : null;
  return id && answer ? { requestID: id, reply: answer } : null;
}

/** Pevná veta systémového promptu (nemení sa počas konverzácie). */
const LINKED_FOLDERS_SYSTEM = "A linked-folders reminder, when present, lists folders the user linked to this client. They belong to this client: read them like the client's own folder, without asking, and pass absolute file paths from them to lawoss_documents_prepare. Open folders of other clients only when the user asks for them; the user then decides on an approval card.";

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

/** Zamietnuté rozsahy po chatoch tejto inštancie a karty, ktoré čakajú na advokáta (len v pamäti, do reštartu enginu). */
const PENDING_LIMIT = 200;
/** Agent chatov tejto inštancie (z „chat.message“), aby YOLO platil len pre chat agenta. */
const AGENTS_LIMIT = 500;

/** Agent poslednej správy používateľa v uložených správach chatu (napr. po prvej otázke pred novou správou). */
function lastUserAgent(data: unknown): string | null {
  if (!Array.isArray(data)) return null;
  for (const message of [...data].reverse()) {
    const info: unknown = message && typeof message === "object" ? Reflect.get(message, "info") : undefined;
    if (!info || typeof info !== "object" || Reflect.get(info, "role") !== "user") continue;
    const agent: unknown = Reflect.get(info, "agent");
    return typeof agent === "string" ? agent : null;
  }
  return null;
}

export const LawossLinkedFolders = async (input: PluginInput) => {
  const saved: SavedConversations = { directory: input.directory, client: input.client?.session?.messages ? { session: { messages: input.client.session.messages.bind(input.client.session) } } : undefined };
  const reminders = appStateReminders("linked-folders", () => linkedFoldersState(input.directory), "This client has no linked folders any more.", saved);
  const refused = new Map<string, Set<string>>();
  const pending = new Map<string, { root: string; targets: string[] }>();
  const agents = new Map<string, string>();
  const remember = (sessionID: string, agent: string) => {
    agents.delete(sessionID);
    agents.set(sessionID, agent);
    const oldest = agents.size > AGENTS_LIMIT ? agents.keys().next() : null;
    if (oldest && !oldest.done) agents.delete(oldest.value);
  };
  const agentOf = async (sessionID: string): Promise<string | null> => {
    const known = agents.get(sessionID);
    if (known) return known;
    const messages = input.client?.session?.messages;
    if (!messages) return null;
    const { data } = await messages.call(input.client?.session, { path: { id: sessionID }, query: { directory: input.directory } }).catch(() => ({ data: undefined }));
    const agent = lastUserAgent(data);
    if (agent) remember(sessionID, agent);
    return agent;
  };
  return ({
  "chat.message": async (hook: { sessionID: string; agent?: string }, output: ChatMessage) => {
    const agent = typeof output.message.agent === "string" ? output.message.agent : hook.agent;
    if (agent) remember(hook.sessionID, agent);
    await reminders.userMessage(hook, output);
  },
  "tool.execute.after": reminders.toolResult,
  "experimental.chat.system.transform": async (_input: unknown, output: { system: string[] }) => { output.system.push(LINKED_FOLDERS_SYSTEM, APP_NAMES_SYSTEM); },
  event: async ({ event }: { event: BusEvent }) => {
    reminders.event({ event: { type: event.type ?? "", properties: event.properties } });
    if (event.type === "permission.replied") {
      const answer = replied(event.properties);
      const card = answer && pending.get(answer.requestID);
      if (!answer || !card) return;
      pending.delete(answer.requestID);
      if (answer.reply !== "reject") return;
      const folders = refused.get(card.root) ?? new Set<string>();
      for (const target of card.targets) folders.add(target);
      refused.set(card.root, folders);
      return;
    }
    if (event.type !== "permission.asked" || !input.directory) return;
    const request = asked(event.properties);
    const reply = input.client?.postSessionIdPermissionsPermissionId;
    if (!request || !reply) return;
    try {
      const decision = await linkedFolderDecision(input.directory, request);
      if (!decision) return;
      const info = await sessionInfo(input, request.sessionID, input.directory);
      if (!(await sessionInDirectory(info, input.directory))) return;
      if (decision.kind === "reject") {
        await rejectWithMessage(input, request, input.directory, REFUSALS.ambiguous);
        return;
      }
      if (decision.kind === "once") {
        await reply.call(input.client, { path: { id: request.sessionID, permissionID: request.id }, body: { response: "once" }, query: { directory: input.directory } });
        return;
      }
      // YOLO: chat agent ide bez karty všade okrem priečinka iného klienta (ten má kartu s varovaním aj v YOLO).
      if (decision.yolo && !decision.otherClient && await agentOf(request.sessionID) === CHAT_AGENT) {
        await reply.call(input.client, { path: { id: request.sessionID, permissionID: request.id }, body: { response: "once" }, query: { directory: input.directory } });
        return;
      }
      // Karta pre advokáta: rozsah, ktorý v tomto rozhovore už zamietol, sa mu znova neukáže.
      const root = await rootSession(input, request.sessionID, info, input.directory);
      if (refusedEarlier(refused.get(root) ?? [], decision.targets)) {
        await rejectWithMessage(input, request, input.directory, REFUSALS.repeated);
        return;
      }
      const targets = decision.targets.filter((target): target is string => target !== null);
      if (!targets.length) return;
      const oldest = pending.size >= PENDING_LIMIT ? pending.keys().next() : null;
      if (oldest && !oldest.done) pending.delete(oldest.value);
      pending.set(request.id, { root, targets });
    } catch {
      // Bez rozhodnutia ostane bežná otázka používateľovi.
    }
  },
  });
};
