import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WikiSuggestions } from "./suggestions.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "wiki-suggestion-")); roots.push(root);
  return { root, store: new WikiSuggestions(root, "project") };
}
const input = { title: "Research", content: "# Research\n\nUseful finding.", destination: { wikiId: "wiki", path: "Research.md", baseRevision: null } };
test("ordinary Markdown drafts survive reopening and detect external agent edits", async () => {
  const { root, store } = await fixture();
  expect(await store.list()).toEqual([]);
  const draft = await store.create(input, "chat");
  const reopened = new WikiSuggestions(root, "project");
  expect(await reopened.read(draft.id)).toEqual(draft);
  await writeFile(join(root, draft.filePath), "# Agent edit");
  expect((await reopened.read(draft.id)).content).toBe("# Agent edit");
  await expect(reopened.update(draft.id, draft.revision, input)).rejects.toThrow("This draft changed");
  expect(await readFile(join(root, draft.filePath), "utf8")).toBe("# Agent edit");
});
test("proposal folders and files cannot be redirected through symlinks", async () => {
  const { root, store } = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "wiki-suggestion-outside-")); roots.push(outside);
  await mkdir(join(root, ".legalwork"));
  await symlink(outside, join(root, ".legalwork/tmp"));
  await expect(store.create(input, null)).rejects.toThrow("without symbolic links");
  await rm(join(root, ".legalwork/tmp"));
  const draft = await store.create(input, null);
  await rm(join(root, draft.filePath));
  await writeFile(join(outside, "secret.md"), "secret");
  await symlink(join(outside, "secret.md"), join(root, draft.filePath));
  await expect(store.read(draft.id)).rejects.toThrow("without symbolic links");
  await expect(store.read("../../secret")).rejects.toThrow("Choose a wiki suggestion");
});
