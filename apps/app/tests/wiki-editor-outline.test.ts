import { expect, test } from "bun:test";
import { $createParagraphNode, $createTextNode, $getNodeByKey, $getRoot, $isElementNode, createEditor } from "lexical";
import { $createHeadingNode, HeadingNode } from "@lexical/rich-text";
import { $wikiEditorOutline } from "../src/react-app/domains/wiki/wiki-outline-plugin";

test("the outline follows heading edits, reordering and deletion without changing the document", () => {
  const editor = createEditor({ namespace: "wiki-outline", nodes: [HeadingNode], onError: error => { throw error; } });
  editor.update(() => {
    $getRoot().append(
      $createHeadingNode("h1").append($createTextNode("Page title")),
      $createHeadingNode("h2").append($createTextNode("Work")),
      $createParagraphNode().append($createTextNode("Not a heading")),
      $createHeadingNode("h3").append($createTextNode("Work")),
      $createHeadingNode("h2").append($createTextNode("Sources")),
      $createHeadingNode("h2"),
      $createHeadingNode("h4").append($createTextNode("Detail")),
    );
  }, { discrete: true });
  const before = editor.getEditorState().toJSON();
  const headings = editor.getEditorState().read($wikiEditorOutline);
  expect(headings.map(({ title, nested }) => ({ title, nested }))).toEqual([
    { title: "Work", nested: false }, { title: "Work", nested: true }, { title: "Sources", nested: false },
  ]);
  expect(new Set(headings.map(heading => heading.key)).size).toBe(3);
  expect(editor.getEditorState().toJSON()).toEqual(before);

  editor.update(() => {
    const work = $getNodeByKey(headings[0].key);
    const sources = $getNodeByKey(headings[2].key);
    if (!$isElementNode(work) || !sources) throw new Error("Missing heading");
    work.clear().append($createTextNode("Experience"));
    work.insertBefore(sources);
    $getNodeByKey(headings[1].key)?.remove();
  }, { discrete: true });
  expect(editor.getEditorState().read($wikiEditorOutline)).toEqual([
    { key: headings[2].key, title: "Sources", nested: false },
    { key: headings[0].key, title: "Experience", nested: false },
  ]);
});
