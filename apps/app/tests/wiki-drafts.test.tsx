import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { useWikiDrafts } from "../src/react-app/domains/wiki/wiki-drafts";

test("a project reader cannot edit or save retained wiki drafts", async () => {
  const scope = `wiki-read-only-${crypto.randomUUID()}`;
  const document = { path: "Person.md", content: "# Person\n", revision: "original", updatedAt: 1 };
  let writes = 0;
  const client = {
    readWikiPage: async () => document,
    writeWikiPage: async () => { writes++; return document; },
  };
  function mount(editableWikiId: string | null) {
    let drafts: ReturnType<typeof useWikiDrafts> | undefined;
    function Harness() { drafts = useWikiDrafts(client, scope, () => {}, editableWikiId); return null; }
    renderToStaticMarkup(<Harness />);
    if (!drafts) throw new Error("Draft hook did not mount");
    return drafts;
  }
  const editor = mount("firm");
  await editor.load("firm", document.path);
  editor.change("firm", document.path, "# Unsaved edit\n");

  const reader = mount(null);
  expect(reader.get("firm", document.path)?.content).toBe("# Unsaved edit\n");
  reader.change("firm", document.path, "# Unwanted change\n");
  expect(reader.get("firm", document.path)?.content).toBe("# Unsaved edit\n");
  expect(await reader.save("firm", document.path)).toBe(false);
  expect(await mount("another-wiki").save("firm", document.path)).toBe(false);
  expect(writes).toBe(0);

  expect(await editor.save("firm", document.path)).toBe(true);
  expect(writes).toBe(1);
});
