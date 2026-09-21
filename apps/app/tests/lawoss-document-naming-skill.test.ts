import { describe, expect, test } from "bun:test";
import { USPORIADAJ_SPIS_SKILL_NAME, usporiadajSpisSkillBody, OKF_CLI_RESOURCE_NAME, okfCliSource } from "../src/lawoss/okf/skill-bundle";
import { installNativeOkfPack } from "../src/lawoss/domains/marketplace/use-native-integrations";

describe("portable naming native skill", () => {
  test("self-contained resource and exact human approval policy", () => {
    const body = usporiadajSpisSkillBody();
    expect(USPORIADAJ_SPIS_SKILL_NAME).toBe("usporiadaj-spis"); expect(body.description).toContain("pomenovanie"); expect(body.content.startsWith("---")).toBe(false);
    for (const phrase of ["resources/okf.js", "PRACOVNY-PROFIL.md", "--manifest", "--plan", "--apply", "explicitné ľudské schválenie", "mtime", "rekurzívny scan", "nevybrané odkazy neboli overené", "recovery-required", "byte-identický"]) expect(body.content).toContain(phrase);
    expect(OKF_CLI_RESOURCE_NAME).toBe("okf.js"); expect(okfCliSource()).toContain("lawoss.document-naming.plan/v1");
  });
  test("real install loop writes three skill/resource pairs to selected workspace", async () => {
    const calls: { workspace: string; kind: string; name: string; resource?: string; content: string }[] = [];
    const client = {
      upsertSkill: async (workspace: string, input: { name: string; content: string }) => { calls.push({ workspace, kind: "skill", name: input.name, content: input.content }); return { ok: true, path: input.name }; },
      upsertSkillResource: async (workspace: string, name: string, input: { name: string; content: string }) => { calls.push({ workspace, kind: "resource", name, resource: input.name, content: input.content }); return { ok: true, path: input.name }; },
    };
    expect((await installNativeOkfPack(client, "selected-matter")).ok).toBe(true);
    expect(calls.map(c => [c.workspace, c.kind, c.name, c.resource ?? ""])).toEqual([
      ["selected-matter", "skill", "novy-spis", ""], ["selected-matter", "resource", "novy-spis", "okf.js"],
      ["selected-matter", "skill", "okf-pamat", ""], ["selected-matter", "resource", "okf-pamat", "okf-memory.js"],
      ["selected-matter", "skill", "usporiadaj-spis", ""], ["selected-matter", "resource", "usporiadaj-spis", "okf.js"],
    ]);
    expect(calls[5]!.content).toBe(okfCliSource());
    await expect(installNativeOkfPack({ ...client, upsertSkillResource: async () => { throw new Error("resource denied"); } }, "selected-matter")).rejects.toThrow("resource denied");
  });
});
