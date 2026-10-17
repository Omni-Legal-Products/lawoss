import { useEffect, useState, type ReactNode } from "react";
import { addEditorWrapper$, realmPlugin, rootEditor$, useCellValues, viewMode$ } from "@mdxeditor/editor";
import { $getRoot, $isElementNode, type LexicalNode } from "lexical";
import { $isHeadingNode } from "@lexical/rich-text";
import { t } from "@/i18n";

type Heading = { key: string; title: string; nested: boolean };

/** Read document headings, excluding the separate editors inside embeds and tables. */
export function $wikiEditorOutline(): Heading[] {
  const headings: Heading[] = [];
  const visit = (node: LexicalNode) => {
    if ($isHeadingNode(node)) {
      const tag = node.getTag();
      const title = node.getTextContent().trim();
      if (title && (tag === "h2" || tag === "h3")) headings.push({ key: node.getKey(), title, nested: tag === "h3" });
    } else if ($isElementNode(node)) node.getChildren().forEach(visit);
  };
  visit($getRoot());
  return headings;
}

function WikiEditorOutline({ children }: { children: ReactNode }) {
  const [editor, mode] = useCellValues(rootEditor$, viewMode$);
  const [headings, setHeadings] = useState<Heading[]>([]);
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const next = editor.getEditorState().read($wikiEditorOutline);
      setHeadings(previous => previous.length === next.length && previous.every((heading, index) =>
        heading.key === next[index].key && heading.title === next[index].title && heading.nested === next[index].nested
      ) ? previous : next);
    };
    update();
    return editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size || dirtyLeaves.size) update();
    });
  }, [editor]);

  const showOutline = mode === "rich-text" && headings.length >= 3;
  return <div className={showOutline ? "wiki-editor-with-outline" : undefined}>
    {children}
    {showOutline && <aside className="wiki-reader-outline">
      <nav aria-label={t("wiki.on_this_page")}>
        <p className="wiki-outline-title">{t("wiki.on_this_page")}</p>
        {headings.map(heading => <button key={heading.key} type="button"
          className={`wiki-outline-link${heading.nested ? " wiki-outline-subsection" : ""}`}
          onMouseDown={event => event.preventDefault()}
          onClick={() => editor?.getElementByKey(heading.key)?.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start",
          })}
        >{heading.title}</button>)}
      </nav>
    </aside>}
  </div>;
}

export const wikiOutlinePlugin = realmPlugin({ init(realm) {
  realm.pub(addEditorWrapper$, WikiEditorOutline);
} });
