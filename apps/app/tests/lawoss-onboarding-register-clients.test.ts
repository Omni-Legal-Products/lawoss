import { describe, expect, test } from "bun:test";
import type { OnboardingApplyResult } from "../src/lawoss/domains/onboarding/api";
import { registerOnboardedWorkspace, registerOtherClients, type RegisterWorkspaceDeps } from "../src/lawoss/domains/onboarding/register-clients";
import { freshOfficeCompletion } from "../src/lawoss/domains/onboarding/found-flow";
import { LITE_CLIENTS_PATH } from "../src/lawoss/lite/links";

const client = (id: string, path: string): OnboardingApplyResult => ({ result: "applied", clientRoot: path, workspace: { id, path } });

describe("registrácia ostatných klientov z dávky praxe", () => {
  test("zaregistruje každého klienta okrem aktívneho, v poradí dávky", async () => {
    const registered: string[] = [];
    const list: { id: string; path: string }[] = [{ id: "ws-1", path: "/p/Alfa" }];
    const last = await registerOtherClients([client("ws-1", "/p/Alfa"), client("ws-2", "/p/Beta"), client("ws-3", "/p/Gama")], "ws-1", async (workspace) => {
      registered.push(workspace.path);
      list.push(workspace);
      return { workspaces: [...list] };
    });
    expect(registered).toEqual(["/p/Beta", "/p/Gama"]);
    expect(last?.workspaces.map(item => item.id)).toEqual(["ws-1", "ws-2", "ws-3"]);
  });

  test("bez ďalších klientov nič nevolá", async () => {
    let calls = 0;
    expect(await registerOtherClients([client("ws-1", "/p/Alfa")], "ws-1", async () => { calls++; return { workspaces: [] }; })).toBeUndefined();
    expect(calls).toBe(0);
  });

  test("odmietne registráciu, ktorá nezachová identitu priečinka", async () => {
    await expect(registerOtherClients([client("ws-2", "/p/Beta")], "ws-1", async () => ({ workspaces: [{ id: "iné", path: "/p/Beta" }] }))).rejects.toThrow(/identity/);
  });
});

describe("registrácia a výber pripojeného priečinka (MČ 19. 10.: odolné voči prerušeniu)", () => {
  const fakeDeps = (desktop: boolean) => {
    const calls: string[] = [];
    const natives: { id: string; path: string }[] = [];
    const deps: RegisterWorkspaceDeps<{ id: string; path: string }, string> = {
      desktop,
      listWorkspaces: async () => { calls.push("list"); return { items: [{ id: "ws-novak", path: "/k/Novák", name: "Novák" }] }; },
      registerWorkingFolder: async (path) => { calls.push(`folder:${path}`); return { id: "ws-folder", path }; },
      createNative: async (input) => {
        calls.push(`create:${input.folderPath}`);
        if (!natives.some(item => item.path === input.folderPath)) natives.push({ id: input.folderPath === "/k/Novák" ? "ws-novak" : input.folderPath === "/p/Nová kancelária" ? "ws-folder" : `ws:${input.folderPath}`, path: input.folderPath });
        return { workspaces: [...natives] };
      },
      selectNative: async (id) => { calls.push(`select:${id}`); },
      runtimeActive: async (id) => { calls.push(`runtime:${id}`); },
      ensureConnection: async (native) => { calls.push(`ensure:${native.id}`); },
      activate: async (id) => { calls.push(`activate:${id}`); return `client:${id}`; },
      remember: (id) => { calls.push(`remember:${id}`); },
    };
    return { calls, deps };
  };
  const result: OnboardingApplyResult = { result: "applied", clientRoot: "/k/Novák", workspace: { id: "ws-novak", path: "/k/Novák" } };

  test("desktop: zaregistruje, vyberie a aktivuje priečinok (viditeľný v bočnom paneli)", async () => {
    const { calls, deps } = fakeDeps(true);
    expect(await registerOnboardedWorkspace(deps, result)).toEqual({ id: "ws-novak", client: "client:ws-novak" });
    expect(calls).toEqual(["list", "create:/k/Novák", "select:ws-novak", "runtime:ws-novak", "ensure:ws-novak", "activate:ws-novak", "remember:ws-novak"]);
  });
  test("druhé volanie (pred usporiadaním a pri dokončení) zachová ten istý priečinok", async () => {
    const { deps } = fakeDeps(true);
    const first = await registerOnboardedWorkspace(deps, result);
    expect(await registerOnboardedWorkspace(deps, result)).toEqual(first);
  });
  test("prehliadač: bez natívnej registrácie len aktivácia na serveri", async () => {
    const { calls, deps } = fakeDeps(false);
    await registerOnboardedWorkspace(deps, result);
    expect(calls).toEqual(["list", "activate:ws-novak", "remember:ws-novak"]);
  });
  test("prax ako jeden priečinok sa zaregistruje ako pracovný priečinok", async () => {
    const { calls, deps } = fakeDeps(false);
    expect((await registerOnboardedWorkspace(deps, undefined, { workingFolder: "/p" }))?.id).toBe("ws-folder");
    expect(calls).toContain("folder:/p");
  });
  test("Začať nanovo: nová kancelária sa zaregistruje a vyberie skôr, než sa ukáže (test 19. 10. 2026)", async () => {
    const { calls, deps } = fakeDeps(true);
    const office: OnboardingApplyResult = { result: "applied", root: "/p/Nová kancelária/Office" };
    const completion = freshOfficeCompletion("/p/Nová kancelária");
    expect(completion).toEqual({ workingFolder: "/p/Nová kancelária", landing: LITE_CLIENTS_PATH });
    expect((await registerOnboardedWorkspace(deps, office, completion))?.id).toBe("ws-folder");
    expect(calls).toEqual(["list", "folder:/p/Nová kancelária", "create:/p/Nová kancelária", "select:ws-folder", "runtime:ws-folder", "ensure:ws-folder", "activate:ws-folder", "remember:ws-folder"]);
  });
});

test("prax s viacerými klientmi: na konci je vybraný a aktívny hlavný klient, nie posledný z dávky (review 6d)", async () => {
  // Ako workspace-store.mjs: každé natívne vytvorenie nastaví selectedId, activeId a watchedId na nový priečinok.
  const store = { selected: "", runtime: "", workspaces: [] as { id: string; path: string }[] };
  const clients: OnboardingApplyResult[] = [client("ws-alfa", "/p/Alfa"), client("ws-beta", "/p/Beta"), client("ws-gama", "/p/Gama")];
  const idOf = (path: string) => clients.find(item => item.workspace?.path === path)?.workspace?.id ?? path;
  const deps: RegisterWorkspaceDeps<{ id: string; path: string }, string> = {
    desktop: true,
    listWorkspaces: async () => ({ items: [] }),
    registerWorkingFolder: async (path) => ({ id: path, path }),
    createNative: async (input) => {
      const id = idOf(input.folderPath);
      if (!store.workspaces.some(item => item.id === id)) store.workspaces.push({ id, path: input.folderPath });
      store.selected = id; store.runtime = id;
      return { workspaces: [...store.workspaces] };
    },
    selectNative: async (id) => { store.selected = id; },
    runtimeActive: async (id) => { store.runtime = id; },
    ensureConnection: async () => undefined,
    activate: async (id) => id,
    remember: () => undefined,
  };
  await registerOnboardedWorkspace(deps, clients[0], { clients });
  expect(store.workspaces.map(item => item.id)).toEqual(["ws-alfa", "ws-beta", "ws-gama"]);
  expect(store.selected).toBe("ws-alfa");
  expect(store.runtime).toBe("ws-alfa");
});
