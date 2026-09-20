import { expect, test } from "bun:test";
import { loadProfilePreview } from "../src/lawoss/okf/load-profile";
import { renderWorkingProfile, workingProfile } from "../../../lawoss/okf/src/profile";

function files(data: Record<string, string>, failures: string[] = []) {
  return {
    statWorkspaceFile: async (_id: string, path: string) => {
      if (failures.includes(path)) throw new Error("permission denied");
      return { ok: true, path, exists: path in data || Object.keys(data).some((key) => key.startsWith(`${path}/`)) };
    },
    readWorkspaceFile: async (_id: string, path: string) => ({ ok: true, path, content: data[path], encoding: "utf8" as const }),
  };
}

test("native preview reads Office custom folders using same parser as CLI", async () => {
  const result = await loadProfilePreview(files({ "Office/okf.config": 'matter_folders:\n  - Drafty\n  - Research\nfolder_roles:\n  drafts: Drafty\ndocument_naming: "{date}_{kind}"\n' }), "w", "Klient/Spisy/Vec", true);
  expect(result.profile?.folders).toEqual(["Drafty", "Research"]);
  expect(result.profile?.roles).toEqual({ drafts: "Drafty" });
  expect(result.source).toBe("Office/okf.config");
});

test("existing matter snapshot wins; client snapshot does not leak into new matter", async () => {
  const snapshot = renderWorkingProfile(workingProfile(["MojeDrafty"], { drafts: "MojeDrafty" }));
  const data = { "Klient/PRACOVNY-PROFIL.md": snapshot, "Klient/Spisy/Vec/PRACOVNY-PROFIL.md": snapshot, "Office/okf.config": "matter_folders:\n  - Ine\n" };
  expect((await loadProfilePreview(files(data), "w", "Klient/Spisy/Vec", true)).profile?.folders).toEqual(["MojeDrafty"]);
  expect((await loadProfilePreview(files(data), "w", "Klient/Spisy/Nova", true)).profile?.folders).toEqual(["Ine"]);
});

test("invalid or inaccessible profile fails closed instead of displaying defaults", async () => {
  await expect(loadProfilePreview(files({ "Office/okf.config": "matter_folders:\n  - ../escape\n" }), "w", "Vec", true)).rejects.toThrow();
  await expect(loadProfilePreview(files({}, ["Vec/PRACOVNY-PROFIL.md"]), "w", "Vec", true)).rejects.toThrow("permission denied");
});

test("nearest Office without config stops search; missing Office warns about preview boundary", async () => {
  expect((await loadProfilePreview(files({ "Klient/Office/README.md": "", "Office/okf.config": "matter_folders:\n  - Outer\n" }), "w", "Klient/Spisy/Vec", true)).profile).toBeUndefined();
  expect((await loadProfilePreview(files({}), "w", "Vec", true)).warning).toContain("nadradený Office");
  await expect(loadProfilePreview(files({}), "w", "../Vec", true)).rejects.toThrow("workspace");
});
