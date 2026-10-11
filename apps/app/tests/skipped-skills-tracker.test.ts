import { expect, test } from "bun:test";
import { createSkippedSkillsTracker } from "../src/react-app/domains/settings/state/skipped-skills-tracker";

function createStorage(initialValue: string | null = null) {
  let value = initialValue;
  return {
    getItem: (_key: string) => value,
    setItem: (_key: string, next: string) => { value = next; },
  };
}

test("suppresses repeated errors and reports changed errors or skills that break again", () => {
  const next = createSkippedSkillsTracker(createStorage());
  const broken = { path: "/skills/broken/SKILL.md", reason: "Invalid YAML" };
  const other = { path: "/skills/other/SKILL.md", reason: "Missing description" };

  expect(next("desktop-global", [broken, broken])).toEqual([broken]);
  expect(next("desktop-global", [broken])).toEqual([]);
  expect(next("desktop-global", [broken, other])).toEqual([other]);
  const changed = { ...broken, reason: "Missing name" };
  expect(next("desktop-global", [changed, other])).toEqual([changed]);
  expect(next("desktop-global", [changed, other])).toEqual([]);
  expect(next("desktop-global", [])).toEqual([]);
  expect(next("desktop-global", [broken])).toEqual([broken]);
});

test("suppresses unchanged errors across app reloads but reports changed and new errors", () => {
  const storage = createStorage();
  const next = createSkippedSkillsTracker(storage);
  const broken = { path: "/skills/broken/SKILL.md", reason: "Invalid YAML" };
  const other = { path: "/skills/other/SKILL.md", reason: "Missing description" };

  expect(next("desktop-global", [broken])).toEqual([broken]);
  const afterReload = createSkippedSkillsTracker(storage);
  expect(afterReload("desktop-global", [broken])).toEqual([]);
  const changed = { ...broken, reason: "Missing name" };
  expect(afterReload("desktop-global", [changed, other])).toEqual([changed, other]);
  expect(createSkippedSkillsTracker(storage)("desktop-global", [changed, other])).toEqual([]);
});

test("persists repaired skills so their next failure warns again after a reload", () => {
  const storage = createStorage();
  const broken = { path: "/skills/broken/SKILL.md", reason: "Invalid YAML" };
  const other = { path: "/skills/other/SKILL.md", reason: "Missing description" };

  expect(createSkippedSkillsTracker(storage)("desktop-global", [broken, other])).toEqual([broken, other]);
  expect(createSkippedSkillsTracker(storage)("desktop-global", [other])).toEqual([]);
  expect(createSkippedSkillsTracker(storage)("desktop-global", [broken, other])).toEqual([broken]);
  expect(createSkippedSkillsTracker(storage)("desktop-global", [])).toEqual([]);
  expect(createSkippedSkillsTracker(storage)("desktop-global", [broken])).toEqual([broken]);
});

test("keeps warning history separate by source across app reloads", () => {
  const storage = createStorage();
  const next = createSkippedSkillsTracker(storage);
  const broken = { path: "/skills/broken/SKILL.md", reason: "Invalid YAML" };

  expect(next("desktop-global", [broken])).toEqual([broken]);
  expect(next("server:remote", [broken])).toEqual([broken]);
  const afterReload = createSkippedSkillsTracker(storage);
  expect(afterReload("server:remote", [])).toEqual([]);
  expect(afterReload("desktop-global", [broken])).toEqual([]);
  expect(createSkippedSkillsTracker(storage)("desktop-global", [broken])).toEqual([]);
  expect(createSkippedSkillsTracker(storage)("server:remote", [broken])).toEqual([broken]);
});

test("ignores corrupt saved history without blocking skill warnings", () => {
  const broken = { path: "/skills/broken/SKILL.md", reason: "Invalid YAML" };
  for (const saved of ["invalid JSON", "{}", JSON.stringify([null, 42, ["desktop-global", null]])]) {
    const storage = createStorage(saved);
    const next = createSkippedSkillsTracker(storage);
    expect(next("desktop-global", [broken])).toEqual([broken]);
    expect(next("desktop-global", [broken])).toEqual([]);
    expect(createSkippedSkillsTracker(storage)("desktop-global", [broken])).toEqual([]);
  }
});

test("suppresses repeats in memory when storage cannot be read or written", () => {
  const next = createSkippedSkillsTracker({
    getItem: () => { throw new Error("Storage unavailable"); },
    setItem: () => { throw new Error("Storage unavailable"); },
  });
  const broken = { path: "/skills/broken/SKILL.md", reason: "Invalid YAML" };

  expect(next("desktop-global", [broken])).toEqual([broken]);
  expect(next("desktop-global", [broken])).toEqual([]);
});
