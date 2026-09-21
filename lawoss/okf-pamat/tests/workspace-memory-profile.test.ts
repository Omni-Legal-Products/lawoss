import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseWorkspaceMemoryProfile, parseWorkspaceMemoryProfileText } from "../src/workspace-memory-profile.ts";
const profile = () => ({ version: 1, matterId: "synthetic", roots: [{ id: "local", path: "." }], sources: [{ id: "memory", root: "local", path: "memory.md", role: "case_memory", required: true, writable: true, anchors: ["SYNTHETIC"] }] });
test("browser profile parser round trips v1 and has no Node imports", () => {
  assert.deepEqual(parseWorkspaceMemoryProfileText(JSON.stringify(profile())), profile());
  assert.ok(!readFileSync(new URL("../src/workspace-memory-profile.ts", import.meta.url), "utf8").includes('from "node:'));
});
test("shared parser rejects identity/count/path/role/anchor violations", () => {
  const invalid: unknown[] = [null, {}, { ...profile(), version: 2 }, { ...profile(), matterId: "../escape" }, { ...profile(), roots: [] }, { ...profile(), sources: [] }, { ...profile(), sources: Array(257).fill(profile().sources[0]) }];
  for (const path of ["/abs", "../escape", "a\\b", "C:/escape", "a//b", "a/./b", "a\0b"]) invalid.push({ ...profile(), sources: [{ ...profile().sources[0], path }] });
  for (const patch of [{ role: "rules" }, { required: false }, { anchors: [] }, { anchors: [""] }, { root: "unknown" }]) invalid.push({ ...profile(), sources: [{ ...profile().sources[0], ...patch }] });
  invalid.push({ ...profile(), sources: [profile().sources[0], { ...profile().sources[0], id: "MEMORY" }] });
  for (const value of invalid) assert.throws(() => parseWorkspaceMemoryProfile(value));
  assert.throws(() => parseWorkspaceMemoryProfileText(JSON.stringify({ ...profile(), oversized: "é".repeat(256 * 1024) })));
});
