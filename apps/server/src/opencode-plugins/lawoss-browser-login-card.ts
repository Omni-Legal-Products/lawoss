/**
 * LAWOSS (rozhodnutie MČ 9. 11. 2026): karta advokáta pred zmenou uloženého prihlásenia.
 *
 * `legalwork_browser_add_website` pridáva k uloženému prihláseniu ďalšiu stránku a voliteľne aj
 * prihlasovaciu doménu, na ktorej sa potom vypĺňa uložené heslo. Upstream to robí bez karty. LAWOSS
 * sa pred zápisom pýta vlastným povolením `lawoss_browser_login` s jednou kartou, ktorá ukáže
 * prihlásenie, pridávanú stránku a doménu, kde sa bude vypĺňať heslo. Engine si odpoveď nepamätá
 * (`always: []`) a pravidlo je pevné „pýtať sa“ aj v YOLO, lebo ide o heslo
 * (`lawoss/tool-permission-defaults.ts`, `browserLoginRules`). Zamietnutá karta nič nezmení.
 */
import { z } from "zod";
import { nativeToolSignal } from "./native-tool.js";
import { serverUrl, workspaceToolHeaders, type OpenCodeContext } from "./office-plugin-shared.js";
import { BROWSER_LOGIN_PERMISSION } from "../lawoss/tool-permission-defaults.js";

export { BROWSER_LOGIN_PERMISSION };

/** What the card shows; no username and no password ever. */
export type BrowserLoginCard = {
  passwordId: string;
  label: string;
  origin: string;
  website: string;
  name: string | null;
  /** The sign-in origin that gains password filling, or `null` for a navigation destination only. */
  loginOrigin: string | null;
};

const savedLogins = z.object({ items: z.array(z.object({ id: z.string(), label: z.string(), origin: z.string() })) });

async function savedLogin(workspaceId: string, passwordId: string, context: OpenCodeContext) {
  const response = await fetch(`${serverUrl()}/workspace/${encodeURIComponent(workspaceId)}/browser-connections`, {
    headers: await workspaceToolHeaders(context), signal: nativeToolSignal(10000),
  });
  if (!response.ok) throw new Error("Saved website connections are unavailable to this chat.");
  const found = savedLogins.parse(await response.json()).items.find(item => item.id === passwordId);
  if (!found) throw new Error("No saved login has this password_id. Use legalwork_browser_connections to find it. Nothing was changed.");
  return found;
}

/** The card's content for one addition. */
export function browserLoginCard(login: { id: string; label: string; origin: string }, input: { url: string; name?: string; login_url?: string }): BrowserLoginCard {
  return { passwordId: login.id, label: login.label, origin: login.origin, website: input.url, name: input.name ?? null,
    loginOrigin: input.login_url ? new URL(input.login_url).origin : null };
}

/** Ask the lawyer before the saved login changes; a declined card throws and nothing is written. */
export async function askBrowserLoginWebsite(workspaceId: string, input: { password_id: string; url: string; name?: string; login_url?: string }, context: OpenCodeContext) {
  if (!context.ask) throw new Error("Adding a website to a saved login needs the user's approval, but approval requests are unavailable. Nothing was changed.");
  const card = browserLoginCard(await savedLogin(workspaceId, input.password_id, context), input);
  await context.ask({ permission: BROWSER_LOGIN_PERMISSION, patterns: [card.loginOrigin ?? new URL(card.website).origin], always: [],
    metadata: { lawossBrowserLogin: card } });
}
