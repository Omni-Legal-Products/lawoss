import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const STORAGE_KEY = "legalwork:document-preferences:v1";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const browserStorage = () => localStorage;

function storedAutosave(fallback: Record<string, boolean>, getStorage: () => PreferenceStorage) {
  try {
    const value: unknown = JSON.parse(getStorage().getItem(STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object" || !("state" in value) || !value.state || typeof value.state !== "object" || !("autosave" in value.state)) return fallback;
    const autosave = value.state.autosave;
    if (!autosave || typeof autosave !== "object" || Array.isArray(autosave)) return fallback;
    return Object.fromEntries(Object.entries(autosave).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch { return fallback; }
}

export type DocumentSplitOrientation = "horizontal" | "vertical";

type DocumentPreferences = {
  autosave: Record<string, boolean>;
  splitSize: number;
  stackedSplitSize: number;
  splitOrientation: DocumentSplitOrientation;
  setSplitOrientation: (orientation: DocumentSplitOrientation) => void;
  setSplitSize: (size: number, orientation?: DocumentSplitOrientation) => void;
  setAutosave: (key: string, enabled: boolean) => void;
};

export function createDocumentPreferences(getStorage: () => PreferenceStorage) {
  return create<DocumentPreferences>()(persist((set) => ({
    autosave: {},
    splitSize: 50,
    stackedSplitSize: 50,
    splitOrientation: "horizontal",
    setSplitOrientation: (splitOrientation) => set(state => ({ splitOrientation, autosave: storedAutosave(state.autosave, getStorage) })),
    setSplitSize: (size, orientation = "horizontal") => set(state => ({ ...(orientation === "vertical" ? { stackedSplitSize: size } : { splitSize: size }), autosave: storedAutosave(state.autosave, getStorage) })),
    setAutosave: (key, enabled) => set((state) => ({ autosave: { ...storedAutosave(state.autosave, getStorage), [key]: enabled } })),
  }), {
    name: STORAGE_KEY,
    storage: createJSONStorage(getStorage),
    partialize: (state) => ({ autosave: state.autosave, splitSize: state.splitSize, stackedSplitSize: state.stackedSplitSize, splitOrientation: state.splitOrientation }),
  }));
}

/** Per-file overrides shared by tabs on this device. Text defaults on, DOCX off. */
export const useDocumentPreferences = createDocumentPreferences(browserStorage);

// Other windows may toggle a file while this renderer is in the background.
if (typeof window !== "undefined") window.addEventListener("storage", event => {
  if (event.key !== STORAGE_KEY) return;
  const current = useDocumentPreferences.getState().autosave;
  const autosave = storedAutosave(current, browserStorage);
  if (JSON.stringify(current) !== JSON.stringify(autosave)) useDocumentPreferences.setState({ autosave });
});
