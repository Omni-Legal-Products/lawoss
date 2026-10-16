import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSkillFrontmatter } from "./skill-frontmatter.mjs";

test("parses unquoted colons in skill descriptions like OpenCode", () => {
  const parsed = parseSkillFrontmatter("---\nname: caption-templates\ndescription: Review: client captions\n---\n\n# Captions\n");
  assert.equal(parsed.data.name, "caption-templates");
  assert.equal(parsed.data.description, "Review: client captions");
  assert.equal(parsed.content, "\n# Captions\n");
});

test("preserves valid YAML without sanitizing it", () => {
  const parsed = parseSkillFrontmatter("---\nname: caption-templates\ndescription: 'Review: client captions'\n---\nBody\n");
  assert.equal(parsed.data.description, "Review: client captions");
  assert.equal(parsed.content, "Body\n");
});

for (const tag of ["js", "JS", "javascript", "JavaScript", " javascript"]) {
  test(`rejects executable ${tag} metadata without evaluating it`, () => {
    delete globalThis.lawossFrontmatterProbe;
    try {
      assert.throws(() => parseSkillFrontmatter(`\uFEFF---${tag}\r\n(globalThis.lawossFrontmatterProbe = true, {})\r\n---\r\nBody`));
      assert.equal(globalThis.lawossFrontmatterProbe, undefined);
    } finally { delete globalThis.lawossFrontmatterProbe; }
  });
}

test("JSON metadata and code-looking YAML remain inert data", () => {
  assert.deepEqual(parseSkillFrontmatter('---json\n{"name":"demo"}\n---\nBody').data, { name: "demo" });
  assert.equal(parseSkillFrontmatter("---\nname: 'globalThis.lawossFrontmatterProbe = true'\n---\nBody").data.name, "globalThis.lawossFrontmatterProbe = true");
});
