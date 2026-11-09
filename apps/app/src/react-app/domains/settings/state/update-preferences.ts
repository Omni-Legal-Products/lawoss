import { UPDATE_AUTO_CHECK_STORAGE_KEY } from "./update-status-store";

const AUTO_DOWNLOAD_KEY = "legalwork.react.settings.update-auto-download";
export type UpdatePreferences = { autoCheck: boolean; autoDownload: boolean };

function readLegacyPreferences(): Partial<UpdatePreferences> {
  const result: Partial<UpdatePreferences> = {};
  try {
    const autoCheck = window.localStorage.getItem(UPDATE_AUTO_CHECK_STORAGE_KEY);
    const autoDownload = window.localStorage.getItem(AUTO_DOWNLOAD_KEY);
    if (autoCheck === "0" || autoCheck === "1") result.autoCheck = autoCheck === "1";
    if (autoDownload === "0" || autoDownload === "1") result.autoDownload = autoDownload === "1";
  } catch {
    // Missing browser preferences never grant permission to contact the updater.
  }
  return result;
}

export async function loadUpdatePreferences(): Promise<UpdatePreferences> {
  if (typeof window === "undefined") return { autoCheck: false, autoDownload: false };
  const legacy = readLegacyPreferences();
  const bridge = window.__LEGALWORK_ELECTRON__?.updater;
  try {
    if (bridge?.getPreferences) return await bridge.getPreferences(legacy);
    return { autoCheck: legacy.autoCheck ?? false, autoDownload: legacy.autoDownload ?? false };
  } catch {
    return { autoCheck: false, autoDownload: false };
  }
}

export async function saveUpdatePreferences(patch: Partial<UpdatePreferences>): Promise<UpdatePreferences> {
  const bridge = window.__LEGALWORK_ELECTRON__?.updater;
  const preferences = bridge?.setPreferences
    ? await bridge.setPreferences(patch)
    : { ...await loadUpdatePreferences(), ...patch };
  try {
    // Compatibility mirror only. The native file remains authoritative.
    window.localStorage.setItem(UPDATE_AUTO_CHECK_STORAGE_KEY, preferences.autoCheck ? "1" : "0");
    window.localStorage.setItem(AUTO_DOWNLOAD_KEY, preferences.autoDownload ? "1" : "0");
  } catch { /* Native settings also survive inaccessible localStorage. */ }
  return preferences;
}
