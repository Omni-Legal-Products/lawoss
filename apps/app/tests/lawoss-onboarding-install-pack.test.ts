import { expect, test } from "bun:test";
import { installMissingOnboardingSkills } from "../src/lawoss/domains/onboarding/install-pack";
import { novySpisSkillBody, okfCliSource } from "../src/lawoss/okf/skill-bundle";
import type { OkfSkillClient } from "../src/lawoss/okf/skill-refresh";

type Skill = { name: string; scope: "project" | "global"; content: string };

function clientFixture(skills: Skill[], resources = new Map<string, Map<string, string>>()) {
  const calls = { skill: [] as string[], resource: [] as string[] };
  const client: OkfSkillClient = {
    listSkills: async () => ({ items: skills.map(({ name, scope }) => ({ name, scope, path: `/${name}`, description: "" })), skipped: [] }),
    getSkill: async (_workspaceId, name) => ({ item: { name, path: `/${name}`, description: "", scope: "project" }, content: skills.find((skill) => skill.name === name)?.content ?? "" }),
    listSkillResources: async (_workspaceId, skill) => ({ items: [...(resources.get(skill)?.keys() ?? [])].map((name) => ({ name, path: `/${name}`, size: 1, updatedAt: 0 })) }),
    getSkillResource: async (_workspaceId, skill, name) => ({ item: { name, path: `/${name}`, size: 1, updatedAt: 0 }, content: resources.get(skill)?.get(name) ?? "" }),
    upsertSkill: async (_workspaceId, input) => { calls.skill.push(input.name); skills.push({ name: input.name, scope: "project", content: input.content }); return { name: input.name, path: "/", description: "", scope: "project" }; },
    upsertSkillResource: async (_workspaceId, skill, input) => {
      calls.resource.push(`${skill}/${input.name}`);
      resources.set(skill, new Map([...(resources.get(skill) ?? []), [input.name, input.content ?? ""]]));
      return { ok: true, name: input.name, path: "/", action: "added" };
    },
  };
  return { client, calls, skills, resources };
}

test("onboarding skill pack preserves installed workspace skills and resources", async () => {
  const f = clientFixture(
    [{ name: "novy-spis", scope: "project", content: novySpisSkillBody("sk").content }, { name: "okf-pamat", scope: "global", content: "global" }],
    new Map([["novy-spis", new Map([["okf.js", okfCliSource()]])]]),
  );
  expect(await installMissingOnboardingSkills(f.client, "workspace", "sk")).toEqual({ modified: [], written: ["usporiadaj-spis", "roztried-spis"] });
  expect(f.calls.skill).toEqual(["usporiadaj-spis", "roztried-spis"]);
  expect(f.calls.resource).toEqual(["usporiadaj-spis/okf.js", "roztried-spis/okf.js"]);
  expect([...(f.resources.get("novy-spis")?.keys() ?? [])]).toEqual(["okf.js"]);
});

test("onboarding skill pack resumes a partial install without replacing completed resources", async () => {
  const f = clientFixture([]);
  let failOnce = true;
  const original = f.client.upsertSkillResource;
  f.client.upsertSkillResource = async (workspaceId, skill, input) => {
    if (skill === "okf-pamat" && failOnce) { failOnce = false; throw new Error("interrupted"); }
    return original(workspaceId, skill, input);
  };
  await expect(installMissingOnboardingSkills(f.client, "workspace", "sk")).rejects.toThrow("interrupted");
  expect([...(f.resources.get("novy-spis")?.keys() ?? [])]).toEqual(["okf.js"]);
  await installMissingOnboardingSkills(f.client, "workspace", "sk");
  expect(f.calls.skill).toEqual(["novy-spis", "okf-pamat", "usporiadaj-spis", "roztried-spis"]);
  expect(f.calls.resource).toEqual(["novy-spis/okf.js", "okf-pamat/okf-memory.js", "usporiadaj-spis/okf.js", "roztried-spis/okf.js"]);
  expect([...(f.resources.get("okf-pamat")?.keys() ?? [])]).toEqual(["okf-memory.js"]);
});

test("onboarding skill pack keeps a customized SKILL.md and reports it", async () => {
  const f = clientFixture(
    [{ name: "novy-spis", scope: "project", content: "---\nname: novy-spis\n---\nMy office rules.\n" }],
    new Map([["novy-spis", new Map([["okf.js", "old"]])]]),
  );
  const result = await installMissingOnboardingSkills(f.client, "workspace", "sk");
  expect(result.modified).toEqual(["novy-spis"]);
  expect(f.skills.find((skill) => skill.name === "novy-spis")?.content).toContain("My office rules.");
  expect(f.resources.get("novy-spis")?.get("okf.js")).toBe(okfCliSource());
});
