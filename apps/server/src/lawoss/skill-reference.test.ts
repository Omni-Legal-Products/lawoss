import { describe, expect, test } from "bun:test";
import { installedSkillName } from "./skill-reference.js";

describe("installedSkillName (#438)", () => {
  test("a path into the skills folder reads as the skill name", () => {
    expect(installedSkillName(".opencode/skills/novy-spis")).toBe("novy-spis");
    expect(installedSkillName("./.opencode/skills/novy-spis/")).toBe("novy-spis");
    expect(installedSkillName(".opencode/skills/novy-spis/SKILL.md")).toBe("novy-spis");
    expect(installedSkillName(".opencode\\skills\\okf-pamat")).toBe("okf-pamat");
  });
  test("a plain name and unrelated paths stay as they are", () => {
    expect(installedSkillName("novy-spis")).toBe("novy-spis");
    expect(installedSkillName("../other/skills/novy-spis")).toBe("../other/skills/novy-spis");
    expect(installedSkillName(".opencode/skills/novy-spis/resources/okf.js")).toBe(".opencode/skills/novy-spis/resources/okf.js");
  });
});
