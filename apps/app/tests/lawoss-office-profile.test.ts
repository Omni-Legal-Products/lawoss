import { t } from "../src/i18n";
import { expect, test } from "bun:test";
import { parseOfficeWorkingProfile, workingProfile } from "../../../lawoss/okf/src/profile";
import { readOfficeProfile, updateOfficeProfile } from "../src/lawoss/okf/office-profile";
import { composePrompt, type NovySpisForm } from "../src/lawoss/okf/compose-prompt";
import { previewPlan } from "../src/lawoss/okf/preview";

const existing = '# Kancelária\nstanding_authorization: "Test Advokát"\nscope: spis\nreason: "len schválený rozsah"\ncustom_setting:\n  preserve: yes\nmatter_folders:\n  - Stare\nfolder_roles: {}\ndocument_naming: "{description}"\nclient_path: "AK/*"\n';
test("office edits preserve unrelated configuration and round-trip through CLI profile reader", () => {
  const profile = workingProfile(["Podklady", "Drafty"], { drafts: "Drafty" }, "{date}_{description}");
  const output = updateOfficeProfile(existing, { profile, clientPath: "Klienti/*" });
  expect(output).toContain(existing.slice(0, existing.indexOf("matter_folders:")));
  expect(parseOfficeWorkingProfile(output)).toEqual(profile);
  expect(readOfficeProfile(output).clientPath).toBe("Klienti/*");
  expect(updateOfficeProfile(output, readOfficeProfile(output))).toBe(output);
});
test("office editing refuses ambiguous keys and unsafe client locations", () => {
  for (const raw of [existing + 'client_path: "Other/*"\n', existing + 'matter_folders : ["Other"]\n']) {
    expect(() => readOfficeProfile(raw)).toThrow();
  }
  for (const clientPath of ["../*", "/outside/*", "AK/**", "AK/../../*", "AK\\*"]) {
    expect(() => updateOfficeProfile(existing, { profile: workingProfile(), clientPath })).toThrow();
  }
});
const form: NovySpisForm = { mode: "okf", subject: "spis", title: "Test vec", ico: "", jurisdikcia: "SK", root: "/office/Client/Spisy", protistrana: "", advokat: 'Test Advokát $x' };
test("the preview and CLI handoff share the explicit lawyer name", () => {
  expect(composePrompt(form)).toContain('--advokat "Test Advokát \\$x"');
  const card = previewPlan(form).find((entry) => entry.path === "matter.md");
  expect(JSON.stringify(card)).toContain("Test Advokát $x");
  expect(composePrompt({ ...form, advokat: "" })).not.toContain("--advokat");
});

test("fallback author is not silently used as a lawyer", async () => {
  const { lawyerName } = await import("../src/lawoss/okf/lawyer-name");
  expect(lawyerName("LegalWork")).toBeUndefined();
  expect(lawyerName(" ")).toBeUndefined();
  expect(lawyerName("  Test   Advokát ")).toBe("Test Advokát");
});

test("valid numeric and bracketed folders retain string role values", () => {
  const profile = workingProfile(["2026", "[Podklady]"], { drafts: "2026", client_documents: "[Podklady]" });
  expect(readOfficeProfile(updateOfficeProfile("", { profile, clientPath: "" })).profile).toEqual(profile);
});

test("office profile uses the selected workspace and refuses ambiguous office or entity roots", async () => {
  const { loadOfficeProfile } = await import("../src/lawoss/okf/office-profile");
  const requests: string[] = [];
  const entries = new Map<string, "file" | "dir">([["_kancelaria", "dir"], ["_kancelaria/okf.config", "file"]]);
  const client = {
    statWorkspaceFile: async (id: string, path: string) => { requests.push(id); return { ok: true, path, exists: entries.has(path), kind: entries.get(path) }; },
    readWorkspaceFile: async (id: string, path: string) => { requests.push(id); return { path, content: existing, bytes: existing.length, updatedAt: 1 }; },
    writeWorkspaceFile: async (): Promise<never> => { throw new Error("Loading cannot write"); },
  };
  expect((await loadOfficeProfile(client, "selected", "/office-root")).path).toBe("_kancelaria/okf.config");
  expect(new Set(requests)).toEqual(new Set(["selected"]));
  entries.set("Office", "dir");
  await expect(loadOfficeProfile(client, "selected", "/office-root")).rejects.toThrow(t("lawoss.setup.error.twoOffices"));
  entries.delete("Office"); entries.set("matter.md", "file");
  await expect(loadOfficeProfile(client, "selected", "/office-root/matter")).rejects.toThrow(t("lawoss.setup.error.officeRoot"));
  entries.clear();
  expect((await loadOfficeProfile(client, "selected", "/office-root/Office")).path).toBe("okf.config");
});

test("relative client paths may contain periods inside ordinary folder names", () => {
  const clientPath = "Kancelaria.v2/Klienti/*";
  expect(readOfficeProfile(updateOfficeProfile("", { profile: workingProfile(), clientPath })).clientPath).toBe(clientPath);
});
