// LAWOSS: mapa obrazoviek pre pribalenú príručku (skill `legalwork-help`, rozhodnutie MČ 8. 11. 2026).
//
// `scripts/help-docs.mjs` číta trasy z `app-root.tsx` a karty nastavení zo `settings-page.tsx` a ku každej
// hľadá stránku tu. Hodnota je názov stránky, ktorá je v `sk/` aj v `cs/`. `null` znamená, že LAWOSS obrazovku
// neukazuje (skrytá plocha upstreamu, `apps/app/src/lawoss/feature-flags.ts`); `screens.json` ju označí
// `hidden: true` a príručka ju neopisuje. Nová trasa alebo karta upstreamu bez riadku tu zastaví generovanie.

/** Priečinky príručky v poradí jazykov; v oboch sú tie isté súbory. */
export const LAWOSS_GUIDE_LANGUAGES = ["sk", "cs"];

/** Stránka, na ktorú ukazuje skrytá obrazovka: obsah príručky (skill hovorí, že LAWOSS ju neponúka). */
export const LAWOSS_HIDDEN_GUIDE = "index.md";

export const lawossRouteGuides = {
  "*": "zaciatok.md",
  "/": "zaciatok.md",
  "/welcome": "zaciatok.md",
  "/home": "chaty.md",
  "/session": "chaty.md",
  "/session/:sessionId": "chaty.md",
  "/workspace/:workspaceId/session": "chaty.md",
  "/workspace/:workspaceId/session/:sessionId": "chaty.md",
  "/workspace/:workspaceId/sessions": "chaty.md",
  "/projects": "klienti-a-pripady.md",
  "/workspace/:workspaceId/project": "klienti-a-pripady.md",
  "/workspace/:workspaceId/files": "klienti-a-pripady.md",
  "/settings/*": "nastavenia.md",
  "/workspace/:workspaceId/settings/*": "nastavenia.md",
  "/tasks": "pokrocily-rezim.md",
  "/workspace/:workspaceId/tasks": "pokrocily-rezim.md",
  "/workflows": "pokrocily-rezim.md",
  "/evals": "pokrocily-rezim.md",
  "/workspace/:workspaceId/evals": "pokrocily-rezim.md",
  "/workspace/:workspaceId/reviews": "pokrocily-rezim.md",
  // Skryté v LAWOSS (feature-flags.ts: HIDDEN_SIDEBAR_ITEMS, ALPHA_HIDE_UNADOPTED_UPSTREAM).
  "/recorder": null,
  "/calendar": null,
  "/workspace/:workspaceId/calendar": null,
  "/scheduled": null,
  "/wikis": null,
  "/wikis/:workspaceId": null,
  "/wikis/:workspaceId/session/:sessionId": null,
  "/workspace/:workspaceId/dashboards": null,
};

export const lawossSettingGuides = {
  general: "nastavenia.md",
  ai: "ai-a-modely.md",
  extensions: "integracie.md",
  permissions: "nastavenia.md",
  personalisation: "nastavenia.md",
  appearance: "nastavenia.md",
  notifications: "nastavenia.md",
  safety: "nastavenia.md",
  shell: "nastavenia.md",
  environment: "nastavenia.md",
  preferences: "nastavenia.md",
  updates: "nastavenia.md",
  "office-addins": "pokrocily-rezim.md",
  "tabular-review": "pokrocily-rezim.md",
  debug: "riesenie-problemov.md",
  // Skryté v LAWOSS (HIDDEN_SETTINGS_TABS).
  account: null,
  recorder: null,
};
