import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { MissingFolderView } from "../src/lawoss/domains/missing-folder";
import { recoverFolder } from "../src/lawoss/shell/workspace-folder";
import { PROJECT_FOLDER_RECONNECTED_EVENT } from "../src/react-app/domains/workspace/project-folder-recovery";

// #494 (PR #500, overené v appke): po vrátení priečinka ostala karta „…sa nenašiel“ bez „Skúsiť znova“ a klient sa
// neobnovil bez obnovenia okna; prehľad praxe ho znova číta až o 5–15 min.
test("#494: a folder that is back reloads the client's queries and announces the reconnected folder", async () => {
  const events = new EventTarget(); let announced = 0, invalidated = 0;
  events.addEventListener(PROJECT_FOLDER_RECONNECTED_EVENT, () => announced++);
  const back = await recoverFolder(async () => ({ entries: [] }), { invalidateQueries: async () => { invalidated++; } }, events);
  expect({ back, invalidated, announced }).toEqual({ back: true, invalidated: 1, announced: 1 });
});

test("#494: a folder that is still missing changes nothing", async () => {
  const events = new EventTarget(); let announced = 0, invalidated = 0;
  events.addEventListener(PROJECT_FOLDER_RECONNECTED_EVENT, () => announced++);
  const back = await recoverFolder(async () => { throw new Error("404 project_folder_unavailable"); }, { invalidateQueries: async () => { invalidated++; } }, events);
  expect({ back, invalidated, announced }).toEqual({ back: false, invalidated: 0, announced: 0 });
});

test("#494: the missing-folder card offers Try again next to Find the moved folder", () => {
  const html = renderToStaticMarkup(<MemoryRouter><MissingFolderView locale="sk" name="SYN Tomáš Švec remeslá" alternatives={[]} busy={false} onSwitch={() => {}} onFind={() => {}} onRetry={() => {}} /></MemoryRouter>);
  expect(html).toContain("Skúsiť znova");
  expect(html).toContain("Nájsť presunutý priečinok");
});

test("#494: a client registered on the desktop under its folder name shows the server's name", async () => {
  const { mergeRouteWorkspaces } = await import("../src/react-app/shell/route-workspaces");
  const path = "/p/Klienti/C024-syn-tomas-svec-remesla";
  const server = [{ id: "ws_c024", name: "SYN Tomáš Švec remeslá", path, workspaceType: "local" }];
  const desktop = [{ id: "ws_c024", name: "C024-syn-tomas-svec-remesla", displayName: "C024-syn-tomas-svec-remesla", path, workspaceType: "local" }];
  const merged = mergeRouteWorkspaces(server as never, desktop as never);
  expect(merged.find(w => w.id === "ws_c024")?.displayNameResolved).toBe("SYN Tomáš Švec remeslá");
  // A name the user gave on the desktop still wins.
  const renamed = mergeRouteWorkspaces(server as never, [{ ...desktop[0], name: "Švec – remeslá", displayName: "Švec – remeslá" }] as never);
  expect(renamed.find(w => w.id === "ws_c024")?.displayNameResolved).toBe("Švec – remeslá");
});
