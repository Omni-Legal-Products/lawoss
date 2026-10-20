// Zlúčenie dev (#168) do natívneho bočného panela: overenie praxe pred chatom u klienta, výber bez priečinkov
// mimo praxe a upozornenie na neúplné pokrytie na Domove klienta (merge 20. 10. 2026).
import { describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { t } from "@/i18n";
import { revalidateClientProject } from "../src/lawoss/lite/client-nav";
import { ClientOverviewView } from "../src/lawoss/lite/client-overview";
import { openClientFolderChat } from "../src/lawoss/lite/office-scope";
import { onboardingErrorMessage } from "../src/lawoss/domains/onboarding/onboarding-errors";
import type { OkfConnection } from "../src/lawoss/okf/connection";
import type { OkfScope } from "../src/lawoss/okf/read-model";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";

const ws = (id: string, path: string): RouteWorkspace => ({ id, path, name: id, displayNameResolved: id, workspaceType: "local" });
const root = ws("root", "/prax");
const alfa = ws("alfa", "/prax/Klienti/Alfa");
const outside = ws("outside", "/ine/Beta");
const connection: OkfConnection = { client: null, baseUrl: "http://x", token: "t", workspaces: [root, alfa, outside], activeWorkspaceId: root.id };

describe("chat u registrovaného klienta praxe (#168 ako openClientChat)", () => {
  test("bez praxe sa nič neoveruje (natívne správanie)", async () => {
    const single: OkfScope = { anchor: alfa, members: [{ workspace: alfa, prefix: "" }] };
    await expect(revalidateClientProject(single, connection, alfa.id)).resolves.toBeUndefined();
    await expect(revalidateClientProject(null, connection, alfa.id)).resolves.toBeUndefined();
  });

  test("v praxi bez spojenia alebo mimo rozsahu praxe odmietne", async () => {
    const practice: OkfScope = { anchor: root, members: [{ workspace: root, prefix: "" }], practiceRoot: "/prax" };
    await expect(revalidateClientProject(practice, null, alfa.id)).rejects.toThrow("client_workspace_unavailable");
    await expect(revalidateClientProject(practice, connection, outside.id)).rejects.toThrow("client_workspace_unavailable");
    await expect(revalidateClientProject(practice, connection, "zmazany")).rejects.toThrow("client_workspace_unavailable");
  });

  test("chat v priečinku klienta bez spojenia odmietne skôr, než čokoľvek aktivuje", async () => {
    const practice: OkfScope = { anchor: root, members: [{ workspace: root, prefix: "" }], practiceRoot: "/prax" };
    await expect(openClientFolderChat(root.id, "/prax/Klienti/Hron", practice, null)).rejects.toThrow("client_workspace_unavailable");
  });
});

test("Domov klienta povie, že prehľad praxe je neúplný (#168 coverage)", () => {
  const render = (partial: boolean) => renderToStaticMarkup(<MemoryRouter><ClientOverviewView workspaceId="alfa" locale="sk" todayIso="2026-10-20" soon={0} matters={[]} deadlines={[]} partial={partial} /></MemoryRouter>);
  expect(render(true)).toContain(t("lawoss.practice.incomplete", "sk"));
  expect(render(true)).toContain("data-lawoss-client-overview-partial");
  expect(render(false)).not.toContain("data-lawoss-client-overview-partial");
});

test("odmietnutý klient pre nový prípad má vetu pre advokáta, nie všeobecnú chybu", () => {
  const quiet = spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      const message = onboardingErrorMessage(new Error("client_workspace_unavailable"), locale);
      expect(message).not.toBe(t("lawoss.onboarding.error_generic", locale));
      expect(message).not.toContain("—");
    }
    expect(onboardingErrorMessage(new Error("client_workspace_unavailable"), "sk")).toContain("Vyberte klienta");
  } finally { quiet.mockRestore(); }
});
