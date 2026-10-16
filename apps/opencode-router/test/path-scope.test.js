import assert from "node:assert/strict";
import test from "node:test";

import {
  isWithinWorkspaceRootPath,
  normalizeScopedDirectoryPath,
} from "../dist/path-scope.js";

test("normalizeScopedDirectoryPath strips Windows verbatim prefixes", () => {
  const workspaceRoot = String.raw`G:\project\legalwork_project`;
  const candidate = String.raw`\\?\G:\project\legalwork_project`;

  assert.equal(
    normalizeScopedDirectoryPath(workspaceRoot, "win32"),
    "g:/project/legalwork_project",
  );
  assert.equal(
    normalizeScopedDirectoryPath(candidate, "win32"),
    "g:/project/legalwork_project",
  );
});

test("isWithinWorkspaceRootPath accepts Windows verbatim aliases for workspace root", () => {
  const workspaceRoot = String.raw`G:\project\legalwork_project`;
  const candidate = String.raw`\\?\G:\project\legalwork_project`;

  assert.equal(
    isWithinWorkspaceRootPath({
      workspaceRoot,
      candidate,
      platform: "win32",
    }),
    true,
  );
});

test("isWithinWorkspaceRootPath still rejects directories outside the workspace root", () => {
  const workspaceRoot = String.raw`G:\project\legalwork_project`;
  const candidate = String.raw`\\?\G:\project\outside`;

  assert.equal(
    isWithinWorkspaceRootPath({
      workspaceRoot,
      candidate,
      platform: "win32",
    }),
    false,
  );
});

test("Windows UNC aliases preserve their share boundary on every test host", () => {
  const workspaceRoot = String.raw`\\server\share\project`;
  assert.equal(isWithinWorkspaceRootPath({ workspaceRoot, candidate: String.raw`\\?\UNC\server\share\project\child`, platform: "win32" }), true);
  for (const candidate of [String.raw`\\server\share\project-other`, String.raw`\\server\other\project`, String.raw`H:\project`]) {
    assert.equal(isWithinWorkspaceRootPath({ workspaceRoot, candidate, platform: "win32" }), false);
  }
});

test("scope permits harmless dotted child names while rejecting parent traversal", () => {
  assert.equal(isWithinWorkspaceRootPath({ workspaceRoot: "/workspace", candidate: "/workspace/..notes", platform: "darwin" }), true);
  assert.equal(isWithinWorkspaceRootPath({ workspaceRoot: "/workspace", candidate: "/workspace/../outside", platform: "darwin" }), false);
});
