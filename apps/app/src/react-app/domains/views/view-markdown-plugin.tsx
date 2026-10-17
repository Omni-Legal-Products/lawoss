import { appendCodeBlockEditorDescriptor$, realmPlugin } from "@mdxeditor/editor";
import { InlineView } from "./view-inline";

/** Keep the fenced reference as ordinary Markdown; rendering never rewrites it. */
export const viewMarkdownPlugin = realmPlugin({ init(realm) {
  realm.pub(appendCodeBlockEditorDescriptor$, { priority: 100, match: language => language === "legalwork-view", Editor: ({ code }) => <InlineView source={code} /> });
} });
