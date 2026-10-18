import { expect, test } from "bun:test";
import { lineChanges } from "@legalwork/types/line-diff";

test("line counts cover additions, removals, replacement, duplicates and final newline", () => {
  expect(lineChanges("", "a\nb\n")).toEqual({ added: 2, removed: 0 });
  expect(lineChanges("a\nb\n", "")).toEqual({ added: 0, removed: 2 });
  expect(lineChanges("same\nold\nend\n", "same\nnew\nmore\nend\n")).toEqual({ added: 2, removed: 1 });
  expect(lineChanges("a\nb\na\n", "a\na\n")).toEqual({ added: 0, removed: 1 });
  expect(lineChanges("a", "a\n")).toEqual({ added: 1, removed: 1 });
  expect(lineChanges("a\r\n", "a\n")).toEqual({ added: 0, removed: 0 });
  expect(lineChanges("", "")).toEqual({ added: 0, removed: 0 });
});
test("large rewrites are bounded while small changes in long pages are counted", () => {
  expect(lineChanges("a\n".repeat(3000), "b\n".repeat(3000))).toBeNull();
  expect(lineChanges("a\n".repeat(3000), "a\n".repeat(3000) + "b\n")).toEqual({ added: 1, removed: 0 });
});
