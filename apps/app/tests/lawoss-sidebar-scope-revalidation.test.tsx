// Zlúčenie dev (#168) do natívneho bočného panela: overenie praxe pred chatom u klienta, výber bez priečinkov
// mimo praxe a upozornenie na neúplné pokrytie na Domove klienta (merge 20. 10. 2026, oprava po review).
import { describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { t } from "@/i18n";
import { revalidateClientProject } from "../src/lawoss/lite/client-nav";
import { clientNavPending, contextChoice, newChatAction, projectNewChatAction, settleRootPicker, type NewChatTarget } from "../src/lawoss/lite/client-nav-model";
import { ClientOverviewView } from "../src/lawoss/lite/client-overview";
import { conversationFailureKey, openCheckedConversation } from "../src/lawoss/lite/client-tree-data";
import type { MatterConversation } from "../src/lawoss/lite/matter-conversations";
import { openClientFolderChat } from "../src/lawoss/lite/office-scope";
import { onboardingErrorMessage } from "../src/lawoss/domains/onboarding/onboarding-errors";
import type { OkfConnection } from "../src/lawoss/okf/connection";
import { locateInScope, okfScope, okfScopeKey, type OkfScope } from "../src/lawoss/okf/read-model";
import { isScopeRefusal, revalidateScopeTarget, revalidationScope } from "../src/lawoss/okf/scope-target";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";

const ws = (id: string, path: string, preset?: string): RouteWorkspace => ({ id, path, name: id, displayNameResolved: id, workspaceType: "local", ...(preset ? { preset } : {}) });
const root = ws("root", "/prax");
const alfa = ws("alfa", "/prax/Klienti/Alfa");
const outside = ws("outside", "/ine/Beta");
const connection: OkfConnection = { client: null, baseUrl: "http://x", token: "t", workspaces: [root, alfa, outside], activeWorkspaceId: root.id };
const quiet = () => spyOn(console, "warn").mockImplementation(() => undefined);

describe("chat u registrovaného klienta praxe (#168 ako openClientChat)", () => {
  test("bez známeho koreňa praxe sa nič neoveruje (natívne správanie)", async () => {
    const single: OkfScope = { anchor: alfa, members: [{ workspace: alfa, prefix: "" }] };
    await expect(revalidateClientProject({ practice: false, scope: single, connection }, alfa.id)).resolves.toBeUndefined();
    await expect(revalidateClientProject({ practice: false, scope: null, connection: null }, alfa.id)).resolves.toBeUndefined();
  });

  test("v praxi bez spojenia, bez rozsahu alebo mimo rozsahu praxe odmietne", async () => {
    const practice: OkfScope = { anchor: root, members: [{ workspace: root, prefix: "" }], practiceRoot: "/prax" };
    await expect(revalidateClientProject({ practice: true, scope: practice, connection: null }, alfa.id)).rejects.toThrow("client_workspace_unavailable");
    await expect(revalidateClientProject({ practice: true, scope: null, connection }, alfa.id)).rejects.toThrow("client_workspace_unavailable");
    await expect(revalidateClientProject({ practice: true, scope: practice, connection }, outside.id)).rejects.toThrow("client_workspace_unavailable");
    await expect(revalidateClientProject({ practice: true, scope: practice, connection }, "zmazany")).rejects.toThrow("client_workspace_unavailable");
  });

  test("registrovaný koreň praxe (R8): rozsah bez `practiceRoot` sa neoveruje potichu, rozhoduje známy koreň praxe", async () => {
    // okfScope pri registrovanom koreni vráti jediného člena bez `practiceRoot`; predtým sa overenie preskočilo.
    const r8 = okfScope([root, alfa], root, "/prax");
    expect(r8?.practiceRoot).toBeUndefined();
    await expect(revalidateClientProject({ practice: true, scope: r8, connection }, outside.id)).rejects.toThrow("client_workspace_unavailable");
  });

  test("chat v priečinku klienta bez spojenia odmietne skôr, než čokoľvek aktivuje", async () => {
    const practice: OkfScope = { anchor: root, members: [{ workspace: root, prefix: "" }], practiceRoot: "/prax" };
    await expect(openClientFolderChat(root.id, "/prax/Klienti/Hron", practice, null)).rejects.toThrow("client_workspace_unavailable");
  });
});

describe("overenie z rovnakého zoznamu ako revalidateScopeTarget (žiadne falošné odmietnutia)", () => {
  // Server pozná wiki v praxi; živý panel ju vynecháva a pridáva projekt, ktorý pozná len desktop.
  const wiki = ws("wiki", "/prax/Wiki", "wiki");
  const desktopOnly = ws("desktop", "/prax/Klienti/Len desktop");
  const hron = ws("hron", "/prax/Klienti/Hron");
  const fresh = (workspaceId: string) => ({ listWorkspaceDirectory: async (_ws: string, path: string) => ({ path, truncated: false, entries: [] }), readWorkspaceFile: async () => { throw new Error("404"); }, onboardingStatus: async () => ({ profile: { officeRoot: "/prax" } }), workspaceId });
  const server = (workspaces: RouteWorkspace[]): OkfConnection => ({ client: fresh("x") as never, baseUrl: "http://x", token: "t", authGeneration: 1, workspaces, activeWorkspaceId: alfa.id });

  test("rozsah zo zoznamu servera prejde, rozsah zo živého panela by bol odmietnutý", async () => {
    const loaded = server([alfa, hron, wiki]);
    const live = [alfa, hron, desktopOnly];
    const check = revalidationScope(loaded.workspaces, alfa.id, "/prax");
    const display = okfScope(live, alfa, "/prax");
    expect(check && display && okfScopeKey(check) !== okfScopeKey(display)).toBe(true);
    const load = async () => server([alfa, hron, wiki]);
    await expect(revalidateScopeTarget(display, loaded, hron.id, load)).rejects.toThrow("practice_scope_changed");
    const admitted = await revalidateScopeTarget(check, loaded, hron.id, load);
    expect(admitted.workspace.id).toBe(hron.id);
  });

  test("klient s názvom priečinka v NFD (macOS) je ten istý priečinok ako v NFC", async () => {
    const nfc = ws("ala", "/prax/Klienti/Ála".normalize("NFC"));
    const nfd = ws("ala", "/prax/Klienti/Ála".normalize("NFD"));
    expect(nfc.path).not.toBe(nfd.path);
    const a = okfScope([nfc, hron], nfc, "/prax");
    const b = okfScope([nfd, hron], nfd, "/prax".normalize("NFD"));
    expect(a && b && okfScopeKey(a) === okfScopeKey(b)).toBe(true);
    // Overenie s rozsahom z NFC zoznamu prejde aj vtedy, keď server vráti cestu v NFD.
    const admitted = await revalidateScopeTarget(a, server([nfc, hron]), nfc.id, async () => server([nfd, hron]));
    expect(admitted.workspace.id).toBe("ala");
  });
});

describe("koreň praxe s diakritikou v NFC aj NFD: predpona a cesty sa nepoškodia", () => {
  const forms = ["NFC", "NFD"] as const;
  for (const rootForm of forms) for (const clientForm of forms) {
    test(`koreň ${rootForm}, klient ${clientForm}`, () => {
      const practice = "/Users/a/Kancelária".normalize(rootForm);
      const client = ws("alfa", "/Users/a/Kancelária/Klienti/Álfa".normalize(clientForm));
      const other = ws("beta", "/Users/a/Kancelária/Klienti/Beta".normalize(clientForm));
      const scope = okfScope([client, other], client, practice);
      expect(scope?.practiceRoot).toBe(practice);
      expect(scope?.members.map((m) => m.prefix).sort()).toEqual(["Klienti/Beta", "Klienti/Álfa".normalize("NFC")]);
      for (const input of forms) {
        const at = scope ? locateInScope(scope, "Klienti/Álfa/Spisy/Spor".normalize(input)) : null;
        expect(at?.workspace.id).toBe("alfa");
        expect(at?.path).toBe("Spisy/Spor");
      }
    });
  }
});

describe("existujúci chat po zlyhanom overení sa neotvorí (#168)", () => {
  const conversation: MatterConversation = { id: "s1", workspaceId: alfa.id, title: "Rozhovor", updated: 1, directory: "/prax/Klienti/Alfa" } as MatterConversation;
  const loaded = { ...connection, client: {} as never };

  test("odmietnutie overenia = žiadna trasa ani aktivácia, veta o overení", async () => {
    const restore = quiet();
    try {
      for (const code of ["practice_scope_changed", "client_workspace_unavailable", "client_read_incomplete"]) {
        let opened = false;
        const result = await openCheckedConversation(conversation, { scope: null, connection: loaded }, {
          revalidate: async () => { throw new Error(code); },
          open: async () => { opened = true; return "/workspace/alfa/session/s1"; },
        });
        expect(result).toEqual({ kind: "refused" });
        expect(opened).toBe(false);
        expect(isScopeRefusal(new Error(code))).toBe(true);
      }
      expect(conversationFailureKey({ kind: "refused" })).toBe("lawoss.practice.refused");
      expect(t("lawoss.practice.refused", "sk")).toContain("overiť");
    } finally { restore.mockRestore(); }
  });

  test("iná chyba (sieť) tiež bez trasy; po overení sa chat otvorí", async () => {
    const restore = quiet();
    try {
      const failed = await openCheckedConversation(conversation, { scope: null, connection: loaded }, {
        revalidate: async () => { throw new Error("fetch failed"); },
        open: async () => "/never",
      });
      expect(failed).toEqual({ kind: "failed" });
      expect(conversationFailureKey(failed.kind === "failed" ? failed : { kind: "failed" })).toBe("lawoss.lite.action_error_generic");
    } finally { restore.mockRestore(); }
    const opened = await openCheckedConversation(conversation, { scope: null, connection: loaded }, {
      revalidate: async () => ({ connection: { ...loaded, client: {} as never }, workspace: alfa }),
      open: async () => "/workspace/alfa/session/s1",
    });
    expect(opened).toEqual({ kind: "open", to: "/workspace/alfa/session/s1" });
  });
});

describe("Nový chat: koreň praxe počas čítania, kontext trasy a prázdny výber", () => {
  const rootTarget = (key: string, folder: string): NewChatTarget => ({ id: `root\u0000${key}`, key, workspaceId: "root", folder, root: folder, title: key });
  const project = (id: string): NewChatTarget => ({ id, workspaceId: id, root: `/prax/Klienti/${id}`, title: id });

  test("R1(a): otvorený koreň praxe, prehľad sa číta → výber s čakaním, nie chat nad celou praxou", () => {
    expect(projectNewChatAction("lite", "root", "root", [], undefined, { pending: true })).toEqual({ kind: "pick" });
    expect(projectNewChatAction("lite", "root", "root", [])).toBeNull();
    expect(projectNewChatAction("lite", "tatran", "root", [], undefined, { pending: true })).toBeNull();
    expect(projectNewChatAction("pro", "root", "root", [], undefined, { pending: true })).toBeNull();
    expect(settleRootPicker({ pending: true, isRoot: true, rootTargets: 0 })).toBe("wait");
    expect(settleRootPicker({ isRoot: true, rootTargets: 2 })).toBe("pick");
    expect(settleRootPicker({ isRoot: true, rootTargets: 0 })).toBe("native");
    expect(settleRootPicker({ failed: true, isRoot: true, rootTargets: 0 })).toBe("refuse");
  });

  test("koreň praxe s neúplným prehľadom bez klientov: odmietnutie, nie natívny chat nad celou praxou", () => {
    expect(projectNewChatAction("lite", "root", "root", [], undefined, { incomplete: true })).toEqual({ kind: "refuse" });
    expect(projectNewChatAction("lite", "root", "root", [], undefined, { failed: true })).toEqual({ kind: "refuse" });
    expect(settleRootPicker({ incomplete: true, isRoot: true, rootTargets: 0 })).toBe("refuse");
    // Úplný prehľad bez klientov z OKF = obyčajný projekt.
    expect(projectNewChatAction("lite", "root", "root", [], undefined, {})).toBeNull();
  });

  test("profil onboardingu sa ešte číta: otvorený projekt môže byť koreň praxe, výber počká", () => {
    // Kým sa profil číta, `practiceRootId` je null; natívny chat by mohol vzniknúť nad celou praxou.
    expect(projectNewChatAction("lite", "root", null, [], undefined, { rootUnknown: true })).toEqual({ kind: "pick" });
    expect(projectNewChatAction("pro", "root", null, [], undefined, { rootUnknown: true })).toBeNull();
    expect(settleRootPicker({ rootUnknown: true, isRoot: false, rootTargets: 0 })).toBe("wait");
    expect(settleRootPicker({ isRoot: false, rootTargets: 0 })).toBe("native");
    expect(settleRootPicker({ isRoot: true, rootTargets: 1 })).toBe("pick");
  });

  test("R1(b): detail prípadu a prehľad klienta (bez otvoreného projektu) založia chat u klienta z trasy", () => {
    const choices = [project("alfa"), project("beta"), rootTarget("client:Klienti/Hron", "/prax/Klienti/Hron")];
    const ownerOf = new Map([["client:Klienti/Alfa", "alfa"], ["client:Klienti/Hron", "root"]]);
    expect(contextChoice(choices, "client:Klienti/Alfa", ownerOf)).toEqual(project("alfa"));
    expect(contextChoice(choices, "client:Klienti/Hron", ownerOf)?.folder).toBe("/prax/Klienti/Hron");
    expect(contextChoice(choices, "client:Nikto", ownerOf)).toBeUndefined();
    expect(contextChoice(choices, undefined, ownerOf)).toBeUndefined();
    expect(newChatAction("lite", choices, contextChoice(choices, "client:Klienti/Alfa", ownerOf))).toEqual({ kind: "create", target: project("alfa") });
    expect(newChatAction("lite", choices)).toEqual({ kind: "pick" });
    expect(newChatAction("pro", choices, project("alfa"))).toEqual({ kind: "native" });
  });

  test("bez priečinka (žiadna kotva, rozsah null) sa nečaká: výber s čakaním sa zavrie a ukáže Pridať klienta", () => {
    expect(clientNavPending({ connectionLoading: false, failed: false, scopePending: false, scope: false, data: false })).toBe(false);
    expect(clientNavPending({ connectionLoading: true, failed: false, scopePending: false, scope: false, data: false })).toBe(true);
    expect(clientNavPending({ connectionLoading: false, failed: false, scopePending: true, scope: false, data: false })).toBe(true);
    expect(clientNavPending({ connectionLoading: false, failed: false, scopePending: false, scope: true, data: false })).toBe(true);
    expect(clientNavPending({ connectionLoading: false, failed: true, scopePending: false, scope: true, data: false })).toBe(false);
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      for (const key of ["lawoss.lite.client_pick_empty", "lawoss.practice.refused", "lawoss.practice.refused_overview"]) {
        expect(t(key, locale)).not.toBe(key);
        expect(t(key, locale)).not.toContain("—");
      }
    }
  });
});

test("Domov klienta povie, že prehľad praxe je neúplný (#168 coverage)", () => {
  const render = (partial: boolean) => renderToStaticMarkup(<MemoryRouter><ClientOverviewView workspaceId="alfa" locale="sk" todayIso="2026-10-20" soon={0} matters={[]} deadlines={[]} partial={partial} /></MemoryRouter>);
  expect(render(true)).toContain(t("lawoss.practice.incomplete", "sk"));
  expect(render(true)).toContain("data-lawoss-client-overview-partial");
  expect(render(false)).not.toContain("data-lawoss-client-overview-partial");
});

test("odmietnutý klient pre nový prípad má vetu pre advokáta, nie všeobecnú chybu", () => {
  const restore = quiet();
  try {
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      const message = onboardingErrorMessage(new Error("client_workspace_unavailable"), locale);
      expect(message).not.toBe(t("lawoss.onboarding.error_generic", locale));
      expect(message).not.toContain("—");
    }
    expect(onboardingErrorMessage(new Error("client_workspace_unavailable"), "sk")).toContain("Vyberte klienta");
  } finally { restore.mockRestore(); }
});
