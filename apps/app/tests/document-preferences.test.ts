import { describe, expect, test } from "bun:test";
import { createDocumentPreferences } from "../src/react-app/domains/session/artifacts/document-preferences";

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  };
}

describe("document split preferences", () => {
  test("old saved preferences keep their width and autosave choices with horizontal layout", () => {
    const storage = memoryStorage();
    storage.setItem("legalwork:document-preferences:v1", JSON.stringify({ state: { splitSize: 55, autosave: { contract: true } }, version: 0 }));

    const restored = createDocumentPreferences(() => storage);
    expect(restored.getState()).toMatchObject({ splitSize: 55, stackedSplitSize: 50, splitOrientation: "horizontal", autosave: { contract: true } });
  });

  test("orientation and each divider size survive reload independently", () => {
    const storage = memoryStorage();
    const store = createDocumentPreferences(() => storage).getState();
    store.setSplitSize(60);
    store.setSplitOrientation("vertical");
    store.setSplitSize(40, "vertical");

    const restored = createDocumentPreferences(() => storage);
    expect(restored.getState()).toMatchObject({ splitSize: 60, stackedSplitSize: 40, splitOrientation: "vertical" });
  });
});
