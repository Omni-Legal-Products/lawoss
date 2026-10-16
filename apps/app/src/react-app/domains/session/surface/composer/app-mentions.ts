import { LEGALWORK_EXTENSION_CATALOG } from "@/app/constants";
import { desktopBridge } from "@/app/lib/desktop";
import { isMacPlatform } from "@/app/utils";
import { isLegalWorkExtensionEnabled, isLegalWorkExtensionHidden } from "@/react-app/domains/settings/extension-state";

/**
 * "@App" mentions let the user target a running macOS app for Computer Use
 * straight from the composer (e.g. "@Music"). They are only offered when:
 * - running inside the Electron desktop shell on macOS, and
 * - the Open Computer Use extension is enabled.
 */
export function isAppMentionAvailable(): boolean {
  if (typeof window === "undefined" || !window.__LEGALWORK_ELECTRON__?.invokeDesktop) return false;
  if (!isMacPlatform()) return false;
  const entry = LEGALWORK_EXTENSION_CATALOG.find((candidate) => candidate.id === "open-computer-use");
  if (!entry) return false;
  return isLegalWorkExtensionEnabled(entry) && !isLegalWorkExtensionHidden(entry);
}

/**
 * Instruction text sent to the model for a composer "@App" mention. Steers the
 * agent to the Computer Use MCP tools and an explicit snapshot of the named
 * app instead of assuming the app is frontmost.
 */
export function appMentionInstruction(appName: string) {
  return `[The user mentioned the macOS app "${appName}". Use the open-computer-use MCP tools to see and operate it: start with get_app_state {"app": "${appName}"} — do not assume it is the frontmost app. Prefer element_index from the latest state over coordinates.]`;
}

let appsCache: { at: number; apps: string[] } | null = null;
const APPS_CACHE_TTL_MS = 10_000;

/** List running regular macOS apps for the mention menu. Cached briefly; never throws. */
export async function listRunningAppsForMention(): Promise<string[]> {
  if (!isAppMentionAvailable()) return [];
  if (appsCache && Date.now() - appsCache.at < APPS_CACHE_TTL_MS) return appsCache.apps;
  try {
    const result = await desktopBridge.listRunningApps();
    const apps = Array.isArray(result.apps)
      ? result.apps.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      : [];
    appsCache = { at: Date.now(), apps };
    return apps;
  } catch {
    return [];
  }
}
