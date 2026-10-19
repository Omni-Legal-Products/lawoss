import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { LegalworkServerError } from "../src/app/lib/legalwork-server";
import { readWorkspaceMemory, type OkfReadClient } from "../src/lawoss/okf/read-model";
import { missingFolderAlternatives, unavailableWorkspace } from "../src/lawoss/okf/missing-folder";
import { MissingFolderView } from "../src/lawoss/domains/missing-folder";
import { OkfPageState } from "../src/lawoss/domains/okf-page";
import { askFailurePath } from "../src/lawoss/lite/lite-nav";
import { ADD_FOLDER_PATH, LITE_TODAY_PATH } from "../src/lawoss/lite/links";
import { buildOverview } from "../../../lawoss/okf/read";

// Presne to, čo server vráti, keď priečinok aktívneho pracovného priestoru zmizol (resolveWorkspace v server.ts).
const gone = () => new LegalworkServerError(404, "project_folder_unavailable", "Reconnect the project drive or restore its folder to its original location, then retry.");
const missingClient: OkfReadClient = {
  listWorkspaceDirectory: async () => { throw gone(); },
  readWorkspaceFile: async () => { throw gone(); },
};
const ws = (id: string, path: string, extra: { workspaceType?: "local" | "remote" } = {}) => ({ id, path, name: path.split("/").pop() ?? path, displayNameResolved: path.split("/").pop() ?? path, workspaceType: extra.workspaceType ?? "local" as const });

describe("chýbajúci priečinok aktívneho pracovného priestoru (MČ 19. 10.)", () => {
  test("čítanie pamäte si zapamätá, ktorému priestoru chýba priečinok, nie len anglickú vetu", async () => {
    const data = await readWorkspaceMemory(missingClient, "ws-old");
    expect(data.problems.length).toBeGreaterThan(0);
    expect(data.problems.some(problem => problem.folderUnavailable === "ws-old")).toBe(true);
  });

  test("z problémov čítania aj z chyby dotazu sa určí chýbajúci priestor", () => {
    const workspaces = [ws("ws-old", "/Users/a/Stará kancelária"), ws("ws-new", "/Users/a/Klienti")];
    const empty = { ...buildOverview([], "2026-10-19"), problems: [], truncated: false, inputs: [] };
    expect(unavailableWorkspace(workspaces, { ...empty, problems: [{ path: "", message: "x", folderUnavailable: "ws-old" }] }, null, workspaces[1]!)?.id).toBe("ws-old");
    expect(unavailableWorkspace(workspaces, undefined, gone(), workspaces[0]!)?.id).toBe("ws-old");
    expect(unavailableWorkspace(workspaces, empty, new Error("iné"), workspaces[0]!)).toBeNull();
  });

  test("náhradné priečinky: iné lokálne, bez podpriečinkov chýbajúceho a bez klientov vnútri inej kancelárie", () => {
    const workspaces = [
      ws("missing", "/Users/a/Stará"), ws("inside-missing", "/Users/a/Stará/Klient"),
      ws("office", "/Users/a/Kancelária"), ws("office-client", "/Users/a/Kancelária/Klienti/Alfa"),
      ws("remote", "/srv/x", { workspaceType: "remote" }), ws("other", "/Users/a/Iný"),
    ];
    expect(missingFolderAlternatives(workspaces, workspaces[0]!).map(item => item.id)).toEqual(["office", "other"]);
  });

  test("veta pre advokáta s menom priečinka, Vybrať iný priečinok a prepnutie na iný priečinok", () => {
    const html = renderToStaticMarkup(<MemoryRouter><MissingFolderView locale="sk" name="Stará kancelária" alternatives={[{ id: "ws-new", name: "Klienti" }]} busy={false} onSwitch={() => undefined} /></MemoryRouter>);
    expect(html).toContain("Priečinok Stará kancelária sa nenašiel. Možno bol presunutý, premenovaný alebo je odpojený disk.");
    expect(html).toContain(`href="${ADD_FOLDER_PATH.replace("&", "&amp;")}"`);
    expect(html).toContain("Vybrať iný priečinok");
    expect(html).toContain("Prepnúť na Klienti");
    const alone = renderToStaticMarkup(<MemoryRouter><MissingFolderView locale="sk" name="X" alternatives={[]} busy={false} onSwitch={() => undefined} /></MemoryRouter>);
    expect(alone).not.toContain("Prepnúť na");
  });

  test("stránka namiesto všeobecnej chyby ukáže chýbajúci priečinok a ponechá Skúsiť znova", () => {
    const data = { ...buildOverview([], "2026-10-19"), problems: [{ path: "", message: "Reconnect the project drive", folderUnavailable: "ws-old" }], truncated: false, inputs: [] };
    const html = renderToStaticMarkup(<MemoryRouter><OkfPageState connection="ready" workspace="Stará" error={null} data={data} loading={false} rawProblems={false} missingFolder={<p>CHÝBA</p>} retry={<button>RETRY</button>}>{() => "dashboard"}</OkfPageState></MemoryRouter>);
    expect(html).toContain("CHÝBA");
    expect(html).toContain("RETRY");
    expect(html).not.toContain("cannot establish whether the workspace contains matters");
  });

  test("prax, kde chýba len jeden klient: obsah ostane a nad ním je upozornenie na chýbajúci priečinok", () => {
    const data = { ...buildOverview([{ path: "Alfa/vec", records: [] }], "2026-10-19"), problems: [{ path: "Beta", message: "x", folderUnavailable: "ws-beta" }], truncated: false, inputs: [] };
    const html = renderToStaticMarkup(<MemoryRouter><OkfPageState connection="ready" workspace="Prax" error={null} data={data} loading={false} rawProblems={false} missingFolder={<p>CHÝBA</p>}>{() => "dashboard"}</OkfPageState></MemoryRouter>);
    expect(html).toContain("CHÝBA");
    expect(html).toContain("dashboard");
  });

  test("Opýtať sa pri chýbajúcom priečinku vedie na Dnes s vysvetlením, inak na konverzácie", () => {
    expect(askFailurePath(gone())).toBe(LITE_TODAY_PATH);
    expect(askFailurePath(new Error("iné"))).toBe("/session");
  });
});
