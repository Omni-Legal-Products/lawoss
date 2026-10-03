import { expect, test } from "bun:test";
import { installMissingOnboardingSkills } from "../src/lawoss/domains/onboarding/install-pack";

type Resource = { name: string };
type Skill = { name: string; scope?: "workspace" | "global" };

function clientFixture(skills: Skill[], resources = new Map<string, Resource[]>()) {
  const calls = { skill: [] as string[], resource: [] as string[] };
  const client = {
    listSkills: async () => ({ items: skills }),
    listSkillResources: async (_workspaceId: string, skill: string) => ({ items: resources.get(skill) ?? [] }),
    upsertSkill: async (_workspaceId: string, input: { name: string }) => { calls.skill.push(input.name); skills.push({ name: input.name, scope: "workspace" }); },
    upsertSkillResource: async (_workspaceId: string, skill: string, input: { name: string }) => {
      calls.resource.push(`${skill}/${input.name}`);
      resources.set(skill, [...(resources.get(skill) ?? []), { name: input.name }]);
    },
  };
  return { client, calls, skills, resources };
}

test("onboarding skill pack preserves installed workspace skills and resources", async () => {
  const f = clientFixture(
    [{ name: "novy-spis", scope: "workspace" }, { name: "okf-pamat", scope: "global" }],
    new Map([["novy-spis", [{ name: "okf.js" }]]]),
  );
  await installMissingOnboardingSkills(f.client as never, "workspace", "sk");
  expect(f.calls.skill).toEqual(["usporiadaj-spis"]);
  expect(f.calls.resource).toEqual(["usporiadaj-spis/okf.js"]);
  expect(f.resources.get("novy-spis")).toEqual([{ name: "okf.js" }]);
});

test("onboarding skill pack resumes a partial install without replacing completed resources", async () => {
  const f = clientFixture([]);
  let failOnce = true;
  const original = f.client.upsertSkillResource;
  f.client.upsertSkillResource = async (workspaceId, skill, input) => {
    if (skill === "okf-pamat" && failOnce) { failOnce = false; throw new Error("interrupted"); }
    return original(workspaceId, skill, input);
  };
  await expect(installMissingOnboardingSkills(f.client as never, "workspace", "sk")).rejects.toThrow("interrupted");
  expect(f.resources.get("novy-spis")).toEqual([{ name: "okf.js" }]);
  await installMissingOnboardingSkills(f.client as never, "workspace", "sk");
  expect(f.calls.skill).toEqual(["novy-spis", "okf-pamat", "usporiadaj-spis"]);
  expect(f.calls.resource).toEqual(["novy-spis/okf.js", "okf-pamat/okf-memory.js", "usporiadaj-spis/okf.js"]);
  expect(f.resources.get("okf-pamat")).toEqual([{ name: "okf-memory.js" }]);
});
