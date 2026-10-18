import { expect, test } from "bun:test";
import { sandboxPaths } from "./paths.js";
const mounts = [
  { source: "/Users/test/Project One", target: "/workspace" },
  { source: "/Users/test/Library", target: "/authorized/0" },
  { source: "/Users/test/Project One/.opencode/skills/docx", target: "/skills/0" },
];
test("maps quoted attachment and skill paths using the longest authorized root", () => {
  expect(sandboxPaths(`python3 '/Users/test/Project One/.opencode/skills/docx/tool.py' --input "/Users/test/Project One/.legalwork/attachments/id/input.docx"`, mounts))
    .toBe(`python3 '/skills/0/tool.py' --input "/workspace/.legalwork/attachments/id/input.docx"`);
  expect(sandboxPaths("/Users/test/Project One", mounts)).toBe("/workspace");
  expect(sandboxPaths('path="/Users/test/Library/reference.pdf"', mounts)).toBe('path="/authorized/0/reference.pdf"');
});
test("does not map siblings, unknown roots or already translated paths", () => {
  for (const path of ["/Users/test/Project One Other/input.docx", "/Users/another/file", "/workspace/input.docx"])
    expect(sandboxPaths(path, mounts)).toBe(path);
});
