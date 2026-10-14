import { expect, test } from "bun:test";
import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from "lexical";
import { $createHeadingNode, HeadingNode } from "@lexical/rich-text";
import type { Heading, Paragraph, Root, Text } from "mdast";
import type { MdastImportVisitor } from "@mdxeditor/editor";
// The pinned editor exports its importer at runtime, but omits it from public typings.
// @ts-expect-error Internal API used to test the actual Markdown-to-Lexical pipeline.
import { importMarkdownToLexical } from "@mdxeditor/editor";
import { wikiTitleVisitor } from "../src/react-app/domains/wiki/wiki-title-plugin";

const root: MdastImportVisitor<Root> = { testNode: "root", visitNode: ({ mdastNode, lexicalParent, actions }) => actions.visitChildren(mdastNode, lexicalParent) };
const paragraph: MdastImportVisitor<Paragraph> = { testNode: "paragraph", visitNode: ({ actions }) => actions.addAndStepInto($createParagraphNode()) };
const heading: MdastImportVisitor<Heading> = { testNode: "heading", visitNode: ({ mdastNode, actions }) => actions.addAndStepInto($createHeadingNode(`h${mdastNode.depth}`)) };
const text: MdastImportVisitor<Text> = { testNode: "text", visitNode: ({ mdastNode, actions }) => actions.addAndStepInto($createTextNode(mdastNode.value)) };

function bodyEditor(markdown: string) {
  const editor = createEditor({ namespace: "wiki-title-test", nodes: [HeadingNode], onError: error => { throw error; } });
  editor.update(() => {
    importMarkdownToLexical({ root: $getRoot(), markdown, visitors: [wikiTitleVisitor, root, paragraph, heading, text], syntaxExtensions: [], mdastExtensions: [] });
  }, { discrete: true });
  return editor;
}

test("the first paragraph has no hidden title for Backspace to merge into", () => {
  const editor = bodyEditor('# Page title\n\nFirst paragraph\n\n# Body heading\n\nLast paragraph');
  expect(editor.getEditorState().read(() => $getRoot().getFirstChildOrThrow().getPreviousSibling())).toBeNull();
  expect(editor.getEditorState().read(() => $getRoot().getChildren().map(node => [node.getType(), node.getTextContent()]))).toEqual([
    ["paragraph", "First paragraph"], ["heading", "Body heading"], ["paragraph", "Last paragraph"],
  ]);
});

test("a title-only page has an editable body and later headings stay in the body", () => {
  expect(bodyEditor('# Title').getEditorState().read(() => $getRoot().getFirstChildOrThrow().getType())).toBe('paragraph');
  expect(bodyEditor('Intro\n\n# Body heading').getEditorState().read(() => $getRoot().getChildren().map(node => node.getType()))).toEqual(['paragraph', 'heading', 'paragraph']);
});
