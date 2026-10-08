import { describe, expect, test } from "bun:test";
import { isLawossHomeWorkspace, preferRealWorkspace, withoutLawossHome } from "../src/lawoss/home-workspace";

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
});
