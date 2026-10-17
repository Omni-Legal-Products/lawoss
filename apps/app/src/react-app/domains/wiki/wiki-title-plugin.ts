import type { Heading } from "mdast";
import { addImportVisitor$, realmPlugin, type MdastImportVisitor } from "@mdxeditor/editor";

/** The title has its own input. It must not remain a hidden, editable Lexical block. */
export const wikiTitleVisitor: MdastImportVisitor<Heading> = {
  testNode: "heading",
  priority: 100,
  visitNode({ mdastNode, mdastParent, actions }) {
    if (mdastNode.depth === 1 && mdastParent?.type === "root"
      && mdastParent.children.find(node => node.type !== "yaml") === mdastNode) return;
    actions.nextVisitor();
  },
};

export const wikiTitlePlugin = realmPlugin({ init(realm) {
  realm.pub(addImportVisitor$, wikiTitleVisitor);
} });
