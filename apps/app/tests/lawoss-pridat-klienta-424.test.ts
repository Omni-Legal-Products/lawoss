import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { liteClientFormPath } from "../src/lawoss/lite/client-entry";
import { NEW_CLIENT_PATH } from "../src/lawoss/lite/links";

// #424: „Pridať klienta“ v bežnom režime (chyba Domova, výber klienta na Domove, okno Nový chat, prázdny stav
// a „+“ panela) nesmie otvoriť upstream okno projektu, ktoré bez priečinka zakladá v Documents/LegalWork/Projects.
const source = (path: string) => readFileSync(join(import.meta.dir, "../src", path), "utf8");

describe("Pridať klienta v bežnom režime (#424)", () => {
  test("bežný režim vedie na formulár klienta LAWOSS, Pokročilé ostáva pri upstream okne", () => {
    expect(liteClientFormPath("lite")).toBe(NEW_CLIENT_PATH);
    expect(NEW_CLIENT_PATH).toBe("/welcome?continue=client");
    expect(liteClientFormPath("pro")).toBeNull();
  });

  test("obe miesta, ktoré otvárajú upstream okno projektu, sa v bežnom režime presmerujú", () => {
    const route = source("react-app/shell/session-route.tsx");
    // Jediné otvorenia okna mimo chyby zakladania: handleOpenCreateWorkspace a onCreateProject Domova.
    const opens = route.split("setCreateWorkspaceOpen(true)").length - 1;
    expect(opens).toBe(3);
    const opener = route.slice(route.indexOf("const handleOpenCreateWorkspace = useCallback"), route.indexOf("const handleOpenRenameWorkspace"));
    expect(opener).toContain("liteClientFormPath()");
    expect(opener.indexOf("navigate(liteClientForm)")).toBeLessThan(opener.indexOf("setCreateWorkspaceOpen(true)"));
    const home = route.slice(route.indexOf("<AppHome"), route.indexOf("onProjectChange={(id) => {", route.indexOf("<AppHome")));
    expect(home).toContain("liteClientFormPath()");
    expect(home.indexOf("navigate(liteClientForm)")).toBeLessThan(home.indexOf("setCreateWorkspaceOpen(true)"));
    // Okno Nový chat a panel volajú ten istý handleOpenCreateWorkspace.
    expect(route).toContain("onCreateProject={handleOpenCreateWorkspace}");
    expect(route).toContain("handleOpenCreateWorkspace();");
  });
});
