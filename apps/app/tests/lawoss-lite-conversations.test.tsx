// „Pokračovat, kde jsem skončil“: konverzace nad věcí na stránce Věc.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { LiteMatterView } from "../src/lawoss/lite/pages/matter-page";


describe("stránka Věc", () => {
  const m = { path: "AK/B/Barakat Jalal/2026-09-16_Stepanska", title: "2026-09-16_Stepanska", deadlines: [], openTasks: [], counts: { records: 0, evidence: 0, subjects: 0 } };
  const html = (conversations: Parameters<typeof LiteMatterView>[0]["conversations"]) => renderToStaticMarkup(
    <MemoryRouter><LiteMatterView matter={m} cockpit={null} busy={null} error={null} onAction={() => {}} conversations={conversations} /></MemoryRouter>);
  test("ukáže rozpracované konverzace s Pokračovat", () => {
    const out = html([{ workspaceId: "m1", id: "s1", title: "Odpověď protistraně", updated: Date.UTC(2026, 8, 24, 12, 32) }, { workspaceId: "m1", id: "s2", title: null, updated: 0 }]);
    expect(out).toContain("Conversations in progress");
    expect(out).toContain("Odpověď protistraně");
    expect(out).toContain("Untitled conversation");
    expect(out.match(/Continue/g) ?? []).toHaveLength(2);
  });
  test("bez konverzací oddíl chybí", () => {
    expect(html([])).not.toContain("Conversations in progress");
  });
});
