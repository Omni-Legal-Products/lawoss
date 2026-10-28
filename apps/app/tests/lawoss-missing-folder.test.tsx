import { describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { LegalworkServerError } from "../src/app/lib/legalwork-server";
import { readWorkspaceMemory, type OkfReadClient } from "../src/lawoss/okf/read-model";
import { missingFolderAlternatives, switchToWorkspace, unavailableWorkspace, unavailableWorkspaceIds } from "../src/lawoss/okf/missing-folder";
import { movedClientChoice, reconnectMovedFolder, withReconnectedPaths, type MovedClientChoice, type MovedFolderPreview } from "../src/lawoss/okf/moved-folder";
import type { OnboardingApplyResult } from "../src/lawoss/domains/onboarding/api";
import { movedClientActions, onboardingErrorMessage } from "../src/lawoss/domains/onboarding/onboarding-errors";
import { BatchView } from "../src/lawoss/domains/onboarding/found-screen";
import { addMovedAsNew, linkMovedItem, type BatchItem } from "../src/lawoss/domains/onboarding/found-flow";
import { foundText } from "../src/lawoss/domains/onboarding/found-text";
import { PracticeMoveNoticeView } from "../src/lawoss/domains/practice-move-notice";
import { MissingFolderView } from "../src/lawoss/domains/missing-folder";
import { OkfPageState } from "../src/lawoss/domains/okf-page";
import { ADD_FOLDER_PATH } from "../src/lawoss/lite/links";
import { buildOverview } from "../../../lawoss/okf/read";

const PARTIAL_EN = "Some memory files could not be read";
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
    // Aktívny priečinok (napr. kancelária, keď chýba len jeden klient praxe) nie je kam prepnúť.
    expect(missingFolderAlternatives(workspaces, workspaces[0]!, "office").map(item => item.id)).toEqual(["other"]);
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
    // Upozornenie na neúplné čítanie ostáva aj vedľa chýbajúceho klienta (review 6d).
    expect(html).toContain(PARTIAL_EN);
  });
});

describe("prepnutie na iný priečinok (review 6d: zapojenie)", () => {
  test("aktivuje vybraný priečinok a stránky načíta znova", async () => {
    const activated: string[] = [];
    const events = new EventTarget();
    const reloaded: string[] = [];
    events.addEventListener("lawoss-office-scope-restored", () => reloaded.push("reload"));
    const ok = await switchToWorkspace(async (target) => { activated.push(target.id); }, { id: "ws-new", path: "/Users/a/Klienti" }, events);
    expect(ok).toBe(true);
    expect(activated).toEqual(["ws-new"]);
    expect(reloaded).toEqual(["reload"]);
  });
  test("zlyhané prepnutie vráti false a stránky nenačíta", async () => {
    const events = new EventTarget();
    let reloaded = false;
    events.addEventListener("lawoss-office-scope-restored", () => { reloaded = true; });
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await switchToWorkspace(async () => { throw new Error("engine"); }, { id: "ws-new", path: "/x" }, events)).toBe(false);
    } finally { warn.mockRestore(); }
    expect(reloaded).toBe(false);
  });
});

// N-A7-1 (test A10, 28. 10. 2026): premenovaná prax s klientmi C002 a C017.
describe("presunutá prax: prepojiť, nie pridať znova (N-A7-1)", () => {
  const practice = "/Users/advokat/Prax/3-neusporiadana-prax";
  const workspaces = [ws("ws-c002", `${practice}/C002 SYN Hron`), ws("ws-c017", `${practice}/C017 SYN Šimková`), ws("ws-iny", "/Users/advokat/Iný klient")];

  test("„Prepnúť na“ neponúkne klienta, ktorému tiež chýba priečinok", () => {
    const empty = { ...buildOverview([], "2026-10-28"), truncated: false, inputs: [] };
    const data = { ...empty, problems: [{ path: "", message: "x", folderUnavailable: "ws-c002" }, { path: "", message: "x", folderUnavailable: "ws-c017" }] };
    expect([...unavailableWorkspaceIds(data)].sort()).toEqual(["ws-c002", "ws-c017"]);
    expect(missingFolderAlternatives(workspaces, workspaces[0]!, undefined, unavailableWorkspaceIds(data)).map(item => item.id)).toEqual(["ws-iny"]);
  });

  test("ponuka Nájsť presunutý priečinok a náhľad s menami pred prepojením", () => {
    const find = renderToStaticMarkup(<MemoryRouter><MissingFolderView locale="sk" name="C002 SYN Hron" alternatives={[]} busy={false} onSwitch={() => undefined} onFind={() => undefined} /></MemoryRouter>);
    expect(find).toContain("Nájsť presunutý priečinok");
    expect(find).toContain("Vybrať iný priečinok");
    const review = renderToStaticMarkup(<MemoryRouter><MissingFolderView locale="sk" name="C002 SYN Hron" alternatives={[]} busy={false} onSwitch={() => undefined} onFind={() => undefined} review={{ folder: "3-neusporiadana-prax-PREMENOVANA", names: ["C002 SYN Hron", "C017 SYN Šimková"], notFound: ["C030 SYN Iný"] }} /></MemoryRouter>);
    expect(review).toContain("V priečinku 3-neusporiadana-prax-PREMENOVANA som našiel: C002 SYN Hron, C017 SYN Šimková. Prepojím ich, ich chaty a nastavenia ostanú.");
    expect(review).toContain("Nenašiel som: C030 SYN Iný. Tie ostanú nedostupné.");
    expect(review).toContain("Prepojiť");
    // Počas náhľadu sa neponúka pridanie ani prepnutie.
    expect(review).not.toContain("Vybrať iný priečinok");
  });

  test("po potvrdení prepojí len spoznaných klientov s ich id a potom presunie prax", async () => {
    const renamed = `${practice}-PREMENOVANA`;
    const preview: MovedFolderPreview = { kind: "practice", previousRoot: practice, folderPath: renamed, notFound: [],
      matches: [{ workspaceId: "ws-c002", name: "C002", expectedPath: `${practice}/C002 SYN Hron`, folderPath: `${renamed}/C002 SYN Hron`, evidence: "marker" }, { workspaceId: "ws-c017", name: "C017", expectedPath: `${practice}/C017 SYN Šimková`, folderPath: `${renamed}/C017 SYN Šimková`, evidence: "name" }] };
    const calls: unknown[] = [];
    const client = {
      reconnectWorkspace: async (id: string, payload: { folderPath: string; expectedPath: string }) => { calls.push(["reconnect", id, payload.folderPath]); return { workspace: ws(id, payload.folderPath), persisted: true as const }; },
      lawossMovedFolder: async (path: string, body: unknown) => { calls.push([path, body]); return {}; },
    };
    const outcome = await reconnectMovedFolder(client, preview);
    // Po každom prepojení server presunie povolenie kancelárie, až potom sa dokončí presun praxe.
    expect(calls).toEqual([["reconnect", "ws-c002", `${renamed}/C002 SYN Hron`], ["reconnected", { workspaceId: "ws-c002" }], ["reconnect", "ws-c017", `${renamed}/C017 SYN Šimková`], ["reconnected", { workspaceId: "ws-c017" }], ["moved-practice", { previousRoot: practice, folderPath: renamed }]]);
    expect(outcome).toEqual({ reconnected: preview.matches, failed: [] });
    expect(withReconnectedPaths(workspaces, outcome.reconnected).map(item => [item.id, item.path])).toEqual([["ws-c002", `${renamed}/C002 SYN Hron`], ["ws-c017", `${renamed}/C017 SYN Šimková`], ["ws-iny", "/Users/advokat/Iný klient"]]);
  });

  test("zlyhané prepojenie jedného klienta nezastaví ostatných a appka ho vymenuje", async () => {
    const preview: MovedFolderPreview = { kind: "client", previousRoot: "/a/C002", folderPath: "/b/C002", notFound: [], matches: [{ workspaceId: "ws-c002", name: "C002 SYN Hron", expectedPath: "/a/C002", folderPath: "/b/C002", evidence: "marker" }] };
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const client = { reconnectWorkspace: async () => { throw new Error("busy"); }, lawossMovedFolder: async () => { throw new Error("nemá sa volať"); } };
      expect(await reconnectMovedFolder(client, preview)).toEqual({ reconnected: [], failed: [{ workspaceId: "ws-c002", name: "C002 SYN Hron" }] });
    } finally { warn.mockRestore(); }
  });

  test("zhoda len podľa mena: náhľad to povie výslovne", () => {
    const html = renderToStaticMarkup(<MemoryRouter><MissingFolderView locale="sk" name="C002" alternatives={[]} busy={false} onSwitch={() => undefined} review={{ folder: "Prax", names: ["C002 SYN Hron", "C017 SYN Šimková"], notFound: [], nameOnly: ["C017 SYN Šimková"] }} /></MemoryRouter>);
    expect(html).toContain("Pri C017 SYN Šimková sa zhoduje len meno priečinka, nie značka LAWOSS. Prepojte ich, len ak ide o toho istého klienta; inak zrušte.");
  });

  test("Pridať klienta sa pri možno presunutom klientovi opýta a pomenuje, čo sa zhoduje", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const details = { workspaceId: "ws-c002", name: "C002 SYN Hron", expectedPath: `${practice}/C002 SYN Hron`, folderPath: `${practice}-PREMENOVANA/C002 SYN Hron` };
      const marker = new LegalworkServerError(409, "onboarding_client_moved", "x", { ...details, evidence: "marker" });
      expect(movedClientChoice(marker)).toEqual({ ...details, evidence: "marker" });
      expect(onboardingErrorMessage(marker, "sk")).toBe("Tento priečinok môže patriť klientovi „C002 SYN Hron“, ktorý už v LAWOSS je, len sa nenašiel jeho priečinok. Priečinok nesie značku LAWOSS s pôvodným umiestnením tohto klienta. Je to ten istý klient?");
      const nameOnly = new LegalworkServerError(409, "onboarding_client_moved", "x", { ...details, evidence: "name" });
      expect(onboardingErrorMessage(nameOnly, "sk")).toContain("Zhoduje sa však len meno, môže ísť aj o iného klienta s rovnakým menom.");
      expect(movedClientActions("sk")).toEqual({ link: "Prepojiť", addNew: "Pridať ako nového" });
      expect(movedClientChoice(new LegalworkServerError(409, "onboarding_client_nested", "x", details))).toBeUndefined();
    } finally { warn.mockRestore(); }
  });

  test("dávka praxe: otázka s Prepojiť / Pridať ako nového; Pridať ako nového pošle potvrdenie, Prepojiť zachová id", async () => {
    const root = `${practice}-PREMENOVANA/C002 SYN Hron`;
    const moved: MovedClientChoice = { workspaceId: "ws-c002", name: "C002 SYN Hron", expectedPath: `${practice}/C002 SYN Hron`, folderPath: root, evidence: "name" };
    const items: BatchItem[] = [{ root, name: "C002 SYN Hron", status: "failed", error: "otázka", moved }, { root: "/x/C022", name: "C022", status: "done" }];
    const html = renderToStaticMarkup(<BatchView text={foundText("sk")} busy={false} items={items} onRetry={() => undefined} onContinue={() => undefined} moved={{ labels: movedClientActions("sk"), onLink: () => undefined, onAddNew: () => undefined }} />);
    expect(html).toContain("Prepojiť");
    expect(html).toContain("Pridať ako nového");
    const planned: unknown[] = [];
    const api = {
      planOnboarding: async (request: unknown) => { planned.push(request); return { id: "p", fingerprint: "f", preview: {} }; },
      applyOnboarding: async (): Promise<OnboardingApplyResult> => ({ result: "applied", workspace: { id: "ws-new", path: root } }),
      updateOnboardingProfile: async () => { throw new Error("nemá sa volať"); },
    };
    const added = await addMovedAsNew(api, items, root, { lawyerName: "SYN", jurisdiction: "sk", language: "sk" }, new Date(2026, 9, 28), String);
    expect(planned).toEqual([expect.objectContaining({ action: "existing", root, confirmNewClient: true })]);
    expect(added.map(item => item.status)).toEqual(["done", "done"]);
    const linked = await linkMovedItem(items, root, async (choice) => ({ id: choice.workspaceId, path: choice.folderPath, name: choice.name }), String);
    expect(linked[0]).toMatchObject({ status: "done", result: { workspace: { id: "ws-c002", path: root } } });
    expect(linked[1]).toBe(items[1]!);
  });

  test("nedokončený presun praxe: ponuka Dokončiť presun praxe", () => {
    const html = renderToStaticMarkup(<PracticeMoveNoticeView locale="sk" folder="3-neusporiadana-prax-PREMENOVANA" busy={false} failed={false} onFinish={() => undefined} />);
    expect(html).toContain("Prax sa presunula do priečinka 3-neusporiadana-prax-PREMENOVANA.");
    expect(html).toContain("Dokončiť presun praxe");
  });
});
