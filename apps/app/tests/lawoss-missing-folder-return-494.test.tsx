import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { MissingFolderView } from "../src/lawoss/domains/missing-folder";
import { recoverFolder, watchFolderReturn } from "../src/lawoss/shell/workspace-folder";
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

// Revízia #500: každá úspešná 5 s kontrola obnovila všetky dopyty (s `cancelRefetch: true`), kým karta nezmizla;
// pomalé čítanie prehľadu OKF sa tak rušilo a štartovalo dookola. Teraz sa zruší a spustí len raz.
test("revízia #500: after the folder is back, polling stops and queries are reloaded once", async () => {
  const events = new EventTarget(); let announced = 0, probes = 0, invalidated = 0;
  events.addEventListener(PROJECT_FOLDER_RECONNECTED_EVENT, () => announced++);
  const probe = async () => { probes++; if (probes < 3) throw new Error("404 project_folder_unavailable"); return { entries: [] }; };
  // A slow refresh (longer than several intervals) must not start a second round.
  const queries = { invalidateQueries: async () => { invalidated++; await Bun.sleep(60); } };
  const stop = watchFolderReturn(() => probe, queries, { intervalMs: 10, events });
  await Bun.sleep(250);
  stop();
  expect({ probes, invalidated, announced }).toEqual({ probes: 3, invalidated: 1, announced: 1 });
});

test("revízia #500: a hidden window or a stopped watch does not probe", async () => {
  let probes = 0;
  const probe = async () => { probes++; throw new Error("missing"); };
  const queries = { invalidateQueries: async () => {} };
  const hiddenStop = watchFolderReturn(() => probe, queries, { intervalMs: 10, hidden: () => true, events: new EventTarget() });
  const stop = watchFolderReturn(() => probe, queries, { intervalMs: 10, events: new EventTarget() });
  stop();
  await Bun.sleep(60);
  hiddenStop();
  expect(probes).toBe(0);
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
