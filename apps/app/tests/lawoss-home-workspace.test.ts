import { describe, expect, test } from "bun:test";
import { avoidLawossHomeId, defaultWorkspaceId, isLawossHomeWorkspace, preferRealWorkspace, withoutLawossHome } from "../src/lawoss/home-workspace";

const home = { id: "ws_home", path: "/Users/a/Library/Application Support/LAWOSS/lawoss-domov", workspaceType: "local" };
const homeWin = { id: "ws_home_win", path: "C:\\Users\\a\\AppData\\Roaming\\LAWOSS\\lawoss-domov", workspaceType: "local" };
const client = { id: "ws_client", path: "/Users/a/Klienti/Novák s.r.o", workspaceType: "local" };
const remote = { id: "ws_remote", path: "", workspaceType: "remote" };

describe("domovský priestor", () => {
  test("rozpozná sa podľa posledného segmentu na macOS aj Windows", () => {
    expect(isLawossHomeWorkspace(home)).toBe(true);
    expect(isLawossHomeWorkspace(homeWin)).toBe(true);
    expect(isLawossHomeWorkspace(client)).toBe(false);
    expect(isLawossHomeWorkspace({ path: "/Users/a/lawoss-domov-zaloha" })).toBe(false);
    expect(isLawossHomeWorkspace({ path: null })).toBe(false);
  });
  test("zoznam pre používateľa ho neobsahuje", () => {
    expect(withoutLawossHome([home, client, remote])).toEqual([client, remote]);
  });
  test("skutočný priečinok má prednosť aj pred aktívnym domovským", () => {
    expect(preferRealWorkspace([home, client], "ws_home", item => item.id)).toEqual(client);
    expect(preferRealWorkspace([client, home], "ws_client", item => item.id)).toEqual(client);
  });
  test("bez skutočného priečinka sa použije domovský, vzdialený nie", () => {
    expect(preferRealWorkspace([remote, home], null, item => item.id)).toEqual(home);
    expect(preferRealWorkspace([remote], null, item => item.id)).toBeUndefined();
  });
  const clientB = { id: "ws_b", path: "/Users/a/Klienti/B", workspaceType: "local" };
  test("po odstránení aktívneho priečinka sa nevyberie domov, ak existuje skutočný", () => {
    // domov je zaregistrovaný ako prvý; server aj uložené id ukazujú naň
    expect(avoidLawossHomeId([home, client, clientB], "ws_home")).toBe("ws_client");
    expect(defaultWorkspaceId([home, client, clientB])).toBe("ws_client");
    expect(avoidLawossHomeId([home, client], "ws_client")).toBe("ws_client");
    expect(avoidLawossHomeId([home, remote], "ws_home")).toBe("ws_home");
  });
  test("len domov alebo prázdny zoznam ostáva beze zmeny", () => {
    expect(avoidLawossHomeId([home], "ws_home")).toBe("ws_home");
    expect(defaultWorkspaceId([home])).toBe("ws_home");
    expect(defaultWorkspaceId([remote, home])).toBe("ws_remote");
    expect(defaultWorkspaceId([remote])).toBe("ws_remote");
    expect(defaultWorkspaceId([])).toBe("");
    expect(avoidLawossHomeId([], "x")).toBe("x");
  });
});
