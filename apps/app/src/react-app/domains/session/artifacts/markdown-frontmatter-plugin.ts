import { DecoratorNode, type NodeKey, type SerializedLexicalNode, type Spread } from "lexical";
import type { Yaml } from "mdast";
import { frontmatter } from "micromark-extension-frontmatter";
import { frontmatterFromMarkdown, frontmatterToMarkdown } from "mdast-util-frontmatter";
import { addExportVisitor$, addImportVisitor$, addLexicalNode$, addMdastExtension$, addSyntaxExtension$, addToMarkdownExtension$, realmPlugin, type LexicalExportVisitor, type MdastImportVisitor } from "@mdxeditor/editor";

type SerializedFrontmatter = Spread<{ yaml: string }, SerializedLexicalNode>;

/** Opaque source, never parsed through a string-only form or exposed to block actions. */
export class PreservedFrontmatterNode extends DecoratorNode<null> {
  __yaml: string;
  static getType() { return "frontmatter"; }
  static clone(node: PreservedFrontmatterNode) { return new PreservedFrontmatterNode(node.__yaml, node.__key); }
  static importJSON(node: SerializedFrontmatter) { return new PreservedFrontmatterNode(node.yaml); }
  constructor(yaml: string, key?: NodeKey) { super(key); this.__yaml = yaml; }
  exportJSON(): SerializedFrontmatter { return { ...super.exportJSON(), type: "frontmatter", version: 1, yaml: this.getLatest().__yaml }; }
  createDOM() { const element = document.createElement("div"); element.hidden = true; return element; }
  updateDOM() { return false; }
  decorate() { return null; }
  isInline() { return false; }
  isKeyboardSelectable() { return false; }
  getYaml() { return this.getLatest().__yaml; }
}

const importFrontmatter: MdastImportVisitor<Yaml> = {
  testNode: "yaml",
  visitNode({ mdastNode, actions }) { actions.addAndStepInto(new PreservedFrontmatterNode(mdastNode.value)); },
};
const exportFrontmatter: LexicalExportVisitor<PreservedFrontmatterNode, Yaml> = {
  testLexicalNode: (node): node is PreservedFrontmatterNode => node instanceof PreservedFrontmatterNode,
  visitLexicalNode({ lexicalNode, actions }) { actions.addAndStepInto("yaml", { value: lexicalNode.getYaml() }); },
};

export const preservedFrontmatterPlugin = realmPlugin({ init(realm) {
  realm.pubIn({
    [addSyntaxExtension$]: frontmatter(["yaml", { type: "yaml", fence: { open: "---", close: "..." } }]),
    [addMdastExtension$]: frontmatterFromMarkdown("yaml"),
    [addToMarkdownExtension$]: frontmatterToMarkdown("yaml"),
    [addLexicalNode$]: PreservedFrontmatterNode,
    [addImportVisitor$]: importFrontmatter,
    [addExportVisitor$]: exportFrontmatter,
  });
} });
