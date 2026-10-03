// „Pokračovat, kde jsem skončil“: konverzace nad věcí na stránce Věc.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";
import { listMatterConversations, matterWorkspace } from "../src/lawoss/lite/matter-conversations";
import { LiteMatterView } from "../src/lawoss/lite/pages/matter-page";

const ws = (id: string, path: string): RouteWorkspace => ({ id, path, name: id, displayNameResolved: id, workspaceType: "local" });
const office = ws("office", "/k/Kancelar");
const matter = ws("m1", "/k/Kancelar/AK/B/Barakat Jalal/2026-09-16_Stepanska");

describe("složka věci", () => {
  test("najde registrovanou složku věci podle kanceláře a cesty; jinak null", () => {
    expect(matterWorkspace([office, matter], office, "AK/B/Barakat Jalal/2026-09-16_Stepanska")?.id).toBe("m1");
    expect(matterWorkspace([office, matter], office, "AK/B/Barakat Jalal/jina")).toBeNull();
    expect(matterWorkspace([office], null, "AK/B/x")).toBeNull();
  });
});

describe("seznam konverzací", () => {
  const sessions = [
    { id: "s-old", title: "Shrnutí spisu", time: { created: 1, updated: 100 } },
    { id: "s-new", title: "New session - 2026-09-24T10:00:00Z", time: { created: 2, updated: 300 } },
    { id: "s-mid", title: "Odpověď protistraně", time: { created: 3, updated: 200 } },
  ];
  const calls: unknown[] = [];
  const client = { listSessions: async (id: string, options: unknown) => { calls.push([id, options]); return { items: sessions }; } };
  const connection = { client, baseUrl: "", token: "", workspaces: [office, matter], activeWorkspaceId: "office" };

  test("nejnovější první, jen hlavní konverzace, výchozí název upstreamu = bez názvu", async () => {
    const list = await listMatterConversations(connection as never, "AK/B/Barakat Jalal/2026-09-16_Stepanska", 5);
    expect(list.map((c) => [c.id, c.title])).toEqual([["s-new", null], ["s-mid", "Odpověď protistraně"], ["s-old", "Shrnutí spisu"]]);
    expect(calls[0]).toEqual(["m1", { roots: true, limit: 5 }]);
  });
  test("věc bez registrované složky (žádná akce) → prázdný seznam, žádný dotaz", async () => {
    const before = calls.length;
    expect(await listMatterConversations(connection as never, "AK/X/nikdy", 5)).toEqual([]);
    expect(calls.length).toBe(before);
  });
});

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
