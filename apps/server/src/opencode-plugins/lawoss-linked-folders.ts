/**
 * LAWOSS: pripojené priečinky klienta po chatoch (MČ 19. 10. 2026).
 *
 * Spoločný súbor povolení je jeden pre všetkých klientov, preto v ňom priečinky klientov nie sú a engine sa spýta.
 * Engine 2 má háčik `permission.evaluate`: tento plugin pri otázke `external_directory` povolí („allow“)
 * len vtedy, keď každý cieľ leží v koreni klienta chatu (priečinok jeho relácie) alebo v jeho pripojených priečinkoch
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
// OpenCode 2 načíta `default` export (`Plugin.define`).
import { Plugin } from "@opencode/plugin";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { allowedFolders, canonicalPath, CHAT_AGENT, expandScope, externalDirectoryAllowed, externalDirectoryOtherClient, LINKED_FOLDERS_MAP_FILE, ownerOf, parseLinkedFoldersMap, patternDirectory, refusedEarlier } from "../lawoss/linked-folders-rules.js";
import { registerAppStateReminders } from "./native-app-state-reminders.js";
import { registerPrimaryContext } from "./native-review-worker.js";
import { nativeEvents } from "./native-events.js";
import { engineConfigPath } from "./wiki-agent-secret.js";
import { APP_NAMES_SYSTEM } from "../lawoss/app-setting-names.js";

type Asked = { id: string; sessionID: string; permission: string; patterns: string[] };

/** Mapa od servera a priečinok, v ktorom leží (dáta aplikácie: nikdy sa nepovolia). */
async function readMap() {
  const config = engineConfigPath();
  if (!config) return null;
  try {
    const map = parseLinkedFoldersMap(JSON.parse(await readFile(join(dirname(config), LINKED_FOLDERS_MAP_FILE), "utf8")));
    return map ? { map, appData: await canonicalPath(dirname(config)) } : null;
  } catch {
    return null;
  }
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

/** Zamietnuté rozsahy po hlavných chatoch a karty, ktoré čakajú na advokáta (len v pamäti, do reštartu enginu). */
const PENDING_LIMIT = 200;
const REFUSED_LIMIT = 500;

/** Hlavný chat (chat podagenta patrí chatu, ktorý ho spustil): zamietnutie platí pre celý rozhovor. */
async function rootSession(ctx: Plugin.Context, sessionID: string, parentID: string | undefined): Promise<string> {
  let id = sessionID, parent = parentID;
  for (let depth = 0; parent && depth < 8; depth++) {
    id = parent;
    parent = (await ctx.session.get({ sessionID: id }).catch(() => null))?.parentID;
  }
  return id;
}

export default Plugin.define({
  id: "lawoss.linked-folders",
  async setup(ctx) {
    const refused = new Map<string, Set<string>>();
    const pending = new Map<string, { root: string; targets: string[] }>();
    const reminders = await registerAppStateReminders(ctx, {
      topic: "linked-folders",
      read: (_sessionID, directory) => linkedFoldersState(directory),
      cleared: "This client has no linked folders any more.",
    });
    const context = await registerPrimaryContext(ctx, (event) => {
      event.system.push({ type: "text", text: LINKED_FOLDERS_SYSTEM }, { type: "text", text: APP_NAMES_SYSTEM });
    });
    /** Karty, ktoré plugin nechal advokátovi: kľúč je chat a rozsah, z udalosti `permission.asked` sa priradí ID. */
    const cards = new Map<string, { root: string; targets: string[] }>();
    const cardKey = (sessionID: string, resources: readonly string[]) => [sessionID, ...resources].join("\0");
    const bounded = <V>(map: Map<string, V>, key: string, value: V, limit: number) => {
      map.delete(key);
      map.set(key, value);
      const oldest = map.size > limit ? map.keys().next() : null;
      if (oldest && !oldest.done) map.delete(oldest.value);
    };
    const evaluate = await ctx.permission.hook("evaluate", async (event) => {
      // Zákaz (konfigurácia, firma, agent) ostáva zákazom; povolené sa nerieši.
      if (event.action !== "external_directory" || event.effect !== "ask") return;
      try {
        const session = await ctx.session.get({ sessionID: event.sessionID });
        const decision = await linkedFolderDecision(session.location.directory, { id: "", sessionID: event.sessionID, permission: event.action, patterns: [...event.resources] });
        if (!decision) return;
        if (decision.kind === "reject") { event.effect = "deny"; event.message = REFUSALS.ambiguous; return; }
        if (decision.kind === "once") { event.effect = "allow"; return; }
        // YOLO: chat agent ide bez karty všade okrem priečinka iného klienta (ten má kartu s varovaním aj v YOLO).
        if (decision.yolo && !decision.otherClient && (event.agent ?? session.agent) === CHAT_AGENT) { event.effect = "allow"; return; }
        // Karta pre advokáta: rozsah, ktorý v tomto rozhovore už zamietol, sa mu znova neukáže.
        const root = await rootSession(ctx, event.sessionID, session.parentID);
        if (refusedEarlier(refused.get(root) ?? [], decision.targets)) { event.effect = "deny"; event.message = REFUSALS.repeated; return; }
        const targets = decision.targets.filter((target): target is string => target !== null);
        if (targets.length) bounded(cards, cardKey(event.sessionID, event.resources), { root, targets }, PENDING_LIMIT);
      } catch {
        // Bez rozhodnutia ostane bežná otázka používateľovi.
      }
    });
    const events = nativeEvents(ctx, (event) => {
      if (event.type === "permission.asked") {
        if (event.data.action !== "external_directory") return;
        const key = cardKey(event.data.sessionID, event.data.resources);
        const card = cards.get(key);
        if (!card) return;
        cards.delete(key);
        bounded(pending, event.data.id, card, PENDING_LIMIT);
        return;
      }
      if (event.type !== "permission.replied") return;
      const card = pending.get(event.data.requestID);
      if (!card) return;
      pending.delete(event.data.requestID);
      if (event.data.reply !== "reject") return;
      const folders = refused.get(card.root) ?? new Set<string>();
      for (const target of card.targets) folders.add(target);
      bounded(refused, card.root, folders, REFUSED_LIMIT);
    });
    return async () => { events(); reminders(); await Promise.all([context.dispose(), evaluate.dispose()]); };
  },
});
