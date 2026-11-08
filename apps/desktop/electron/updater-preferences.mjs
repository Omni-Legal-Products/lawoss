import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const UPDATER_PREFERENCES_FILENAME = "electron-updater-preferences.v1.json";
const disabled = () => ({ autoCheck: false, autoDownload: false });

function validPreferences(value) {
  return value && typeof value.autoCheck === "boolean" && typeof value.autoDownload === "boolean";
}

/** Capture first installation before Electron creates its browser profile. */
export function createUpdaterPreferences(app) {
  const directory = app.getPath("userData");
  const filename = path.join(directory, UPDATER_PREFERENCES_FILENAME);
  const freshProfile = !["Local Storage", "Preferences", "legalwork-workspaces.json", "workspace-state.json"]
    .some((name) => existsSync(path.join(directory, name)));
  let initialized = false;
  let pending = Promise.resolve();
  const serialize = (action) => {
    const result = pending.then(action, action);
    pending = result.catch(() => {});
    return result;
  };
  async function persist(preferences) {
    await mkdir(directory, { recursive: true });
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(preferences)}\n`, { mode: 0o600 });
      await rename(temporary, filename);
    } finally {
      await rm(temporary, { force: true });
    }
    return preferences;
  }
  async function read(legacy) {
    try {
      const value = JSON.parse(await readFile(filename, "utf8"));
      if (!validPreferences(value)) throw new Error("Invalid update preferences");
      initialized = true;
      return { autoCheck: value.autoCheck, autoDownload: value.autoDownload };
    } catch (error) {
      if (error?.code === "ENOENT" && !initialized) {
        initialized = true;
        const preferences = {
          autoCheck: typeof legacy?.autoCheck === "boolean" ? legacy.autoCheck : freshProfile,
          autoDownload: typeof legacy?.autoDownload === "boolean" ? legacy.autoDownload : false,
        };
        try { return await persist(preferences); }
        catch (writeError) { console.warn("[updater] cannot save update preferences; automatic updates disabled", writeError); }
      } else {
        initialized = true;
        console.warn("[updater] cannot read update preferences; automatic updates disabled", error);
      }
      return disabled();
    }
  }
  return {
    read: (legacy) => serialize(() => read(legacy)),
    write: (patch) => serialize(async () => {
      if (!patch || typeof patch !== "object" || Object.keys(patch).some((key) =>
        !["autoCheck", "autoDownload"].includes(key) || typeof patch[key] !== "boolean")) {
        throw new Error("Invalid update preferences");
      }
      return persist({ ...await read(), ...patch });
    }),
  };
}
