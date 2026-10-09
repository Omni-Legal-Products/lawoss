import { describe, expect, test } from "bun:test";
import type { OnboardingApplyResult } from "../src/lawoss/domains/onboarding/api";
import { registerOtherClients } from "../src/lawoss/domains/onboarding/register-clients";

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
