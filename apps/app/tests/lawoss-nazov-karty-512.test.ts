import { describe, expect, test } from "bun:test";
import { chatTabLabelUpdates } from "../src/lawoss/shell/chat-tab-labels";
import { chatPanelTab, type ArtifactPanelTab, type PanelTab } from "../src/react-app/domains/session/panel/panel-tab-store";

const file: ArtifactPanelTab = { id: "file:brief", type: "artifact", label: "Brief", value: "brief.md", preview: "markdown" };

function titles(entries: Record<string, string>) {
  return (sessionId: string) => entries[sessionId];
}

describe("#512 karta chatu nesie aktuálny názov chatu", () => {
  test("neaktívna karta dostane nový názov premenovaného chatu", () => {
    const tabs: PanelTab[] = [chatPanelTab("active", "Aktívny"), chatPanelTab("renamed", "Starý názov")];
    expect(chatTabLabelUpdates(tabs, titles({ active: "Aktívny", renamed: "Nový názov" })))
      .toEqual([{ tabId: "chat:renamed", label: "Nový názov" }]);
  });

  test("neznámy alebo prázdny názov kartu neprepíše", () => {
    const tabs: PanelTab[] = [chatPanelTab("unknown", "Uložený"), chatPanelTab("empty", "Uložený")];
    expect(chatTabLabelUpdates(tabs, titles({ empty: "" }))).toEqual([]);
  });

  test("rovnaký názov nevyvolá zmenu", () => {
    expect(chatTabLabelUpdates([chatPanelTab("same", "Zmluva")], titles({ same: "Zmluva" }))).toEqual([]);
  });

  test("iné karty než chat ostanú bez zmeny", () => {
    expect(chatTabLabelUpdates([file], titles({ brief: "Iný", "file:brief": "Iný" }))).toEqual([]);
  });
});
