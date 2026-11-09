/**
 * LAWOSS: karta nástroja `legalwork_browser_add_website` (rozhodnutie MČ 9. 11. 2026). Agent pridáva k uloženému
 * prihláseniu stránku a voliteľne prihlasovaciu doménu, na ktorej sa bude vypĺňať uložené heslo. Advokát vidí
 * prihlásenie, pridávanú stránku a doménu hesla. Údaje prichádzajú zo servera v `metadata.lawossBrowserLogin`
 * karty enginu (povolenie `lawoss_browser_login`, `opencode-plugins/lawoss-browser-login-card.ts`), nikdy
 * meno ani heslo. Karta sa pýta vždy, aj v YOLO; „povoliť pre chat“ nemá (`always: []`).
 */
import { t } from "@/i18n";
import type { FileOperationDetails } from "./file-operation-card";

type BrowserLogin = { label: string; origin: string; website: string; name: string | null; loginOrigin: string | null };

const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;

function browserLogin(metadata: Record<string, unknown>): BrowserLogin | null {
  const raw: unknown = metadata.lawossBrowserLogin;
  if (!raw || typeof raw !== "object") return null;
  const label = text(Reflect.get(raw, "label")), origin = text(Reflect.get(raw, "origin")), website = text(Reflect.get(raw, "website"));
  if (!label || !origin || !website) return null;
  return { label, origin, website, name: text(Reflect.get(raw, "name")), loginOrigin: text(Reflect.get(raw, "loginOrigin")) };
}

/** The card's readable content, or `null` when the request is not from `legalwork_browser_add_website`. */
export function browserLoginCard(metadata: Record<string, unknown>): { title: string; message: string; permissionLabel: string; scopeLabel: string; scopeValue: string; details: FileOperationDetails } | null {
  const login = browserLogin(metadata);
  if (!login) return null;
  const lines = [
    t("lawoss.browser_login.line_login", undefined, { label: login.label, origin: login.origin }),
    login.name
      ? t("lawoss.browser_login.line_website_named", undefined, { name: login.name, url: login.website })
      : t("lawoss.browser_login.line_website", undefined, { url: login.website }),
    login.loginOrigin
      ? t("lawoss.browser_login.line_password", undefined, { origin: login.loginOrigin })
      : t("lawoss.browser_login.line_no_password"),
  ];
  return {
    title: t(login.loginOrigin ? "lawoss.browser_login.title_password" : "lawoss.browser_login.title"),
    message: t(login.loginOrigin ? "lawoss.browser_login.message_password" : "lawoss.browser_login.message"),
    permissionLabel: t("lawoss.browser_login.permission_label"),
    scopeLabel: t("lawoss.browser_login.scope"),
    scopeValue: lines.join("\n"),
    details: { reason: null, lines },
  };
}
