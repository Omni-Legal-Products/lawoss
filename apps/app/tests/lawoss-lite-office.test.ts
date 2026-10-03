import { expect, test } from "bun:test";
import { officeWorkspace } from "../src/lawoss/okf/read-model";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";

const ws = (id: string, path: string, workspaceType: "local" | "remote" = "local"): RouteWorkspace => ({ id, path, name: id, displayNameResolved: id, workspaceType });
const office = ws("office", "/k/Kancelar");
const client = ws("client", "/k/Kancelar/AK/A/ACME s.r.o.");
const matter = ws("matter", "/k/Kancelar/AK/A/ACME s.r.o./Spisy/54 INS 1200-2025");
const sibling = ws("sibling", "/k/Kancelar-archiv");
const conn = (activeWorkspaceId: string, workspaces: RouteWorkspace[]) => ({ client: null, baseUrl: "", token: "", workspaces, activeWorkspaceId });

test("lite reads the office even after a quick action activated the matter folder", () => {
  expect(officeWorkspace(conn("matter", [office, client, matter]))?.id).toBe("office"); // nejvzdálenější předek, ne klient
  expect(officeWorkspace(conn("office", [office, matter]))?.id).toBe("office");
  expect(officeWorkspace(conn("matter", [sibling, matter]))?.id).toBe("matter"); // prefix bez „/“ není předek
  expect(officeWorkspace(conn("matter", [ws("r", "/k/Kancelar", "remote"), matter]))?.id).toBe("matter");
  expect(officeWorkspace(null)).toBeNull();
});

test("settings in lite redirect a matter folder to the office; pro and the office itself stay (review PR #100)", async () => {
  const { setUiMode, currentUiMode } = await import("../src/lawoss/lite/ui-mode");
  const { liteSettingsWorkspace } = await import("../src/lawoss/lite/office-scope");
  const before = currentUiMode();
  try {
    setUiMode("lite");
    expect(liteSettingsWorkspace("matter", [office, client, matter])).toBe("office");
    expect(liteSettingsWorkspace("office", [office, matter])).toBeNull();
    expect(liteSettingsWorkspace("matter", [sibling, matter])).toBeNull();
    setUiMode("pro");
    expect(liteSettingsWorkspace("matter", [office, matter])).toBeNull();
  } finally { setUiMode(before); }
});
