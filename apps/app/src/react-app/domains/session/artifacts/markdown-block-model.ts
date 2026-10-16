import { $createParagraphNode, $getNodeByKey, $getRoot, $getSelection, $isElementNode, $isRangeSelection, $isTextNode, type LexicalNode } from "lexical";

/** A handle always moves a complete top-level block, including a list's children. */
export function $documentBlock(node: LexicalNode | null): LexicalNode | null {
  if (!node || node.getType() === "root") return null;
  const block = node.getTopLevelElement();
  return block && block.getType() !== "frontmatter" ? block : null;
}

export function $selectedDocumentBlock(): LexicalNode | null {
  const selection = $getSelection();
  return $isRangeSelection(selection) ? $documentBlock(selection.anchor.getNode()) : null;
}

export function $moveDocumentBlock(key: string, direction: "up" | "down"): boolean {
  const block = $documentBlock($getNodeByKey(key));
  if (!block) return false;
  const adjacent = direction === "up" ? block.getPreviousSibling() : block.getNextSibling();
  if (!adjacent || adjacent.getType() === "frontmatter") return false;
  if (direction === "up") adjacent.insertBefore(block);
  else adjacent.insertAfter(block);
  return true;
}

export function $dropDocumentBlock(key: string, targetKey: string, after: boolean): boolean {
  const block = $documentBlock($getNodeByKey(key));
  const target = $documentBlock($getNodeByKey(targetKey));
  if (!block || !target || block.is(target)) return false;
  if (after) target.insertAfter(block);
  else target.insertBefore(block);
  return true;
}

export function $deleteDocumentBlock(key: string): boolean {
  const block = $documentBlock($getNodeByKey(key));
  if (!block) return false;
  const next = block.getNextSibling();
  const previous = block.getPreviousSibling();
  if ($isElementNode(next)) next.selectStart();
  else if ($isElementNode(previous) && previous.getType() !== "frontmatter") previous.selectEnd();
  block.remove();
  if (!$documentBlocks().length) {
    const paragraph = $createParagraphNode();
    $getRoot().append(paragraph);
    paragraph.selectStart();
  }
  return true;
}

export function $documentBlocks() {
  return $getRoot().getChildren().filter(node => node.getType() !== "frontmatter");
}

/** Slash insertion is only offered in a standalone paragraph, never inside code or a table. */
export function $slashQuery(): { key: string; query: string } | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const block = $selectedDocumentBlock();
  if (!block || block.getType() !== "paragraph") return null;
  const text = block.getTextContent();
  if (!/^\/[^\n/]{0,40}$/.test(text)) return null;
  const anchor = selection.anchor;
  if (anchor.type !== "text" || anchor.offset !== anchor.getNode().getTextContentSize()) return null;
  return { key: block.getKey(), query: text.slice(1) };
}

export type InlineLinkQuery = { key: string; query: string; start: number; end: number };

/** Links are inline: offer /link at the caret, including in headings, lists and nested cell editors. */
export function $inlineLinkQuery(): InlineLinkQuery | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.type !== "text") return null;
  const node = selection.anchor.getNode();
  if (!$isTextNode(node) || node.hasFormat("code")) return null;
  for (let parent = node.getParent(); parent; parent = parent.getParent()) {
    if (["link", "autolink", "code", "frontmatter"].includes(parent.getType())) return null;
  }
  const end = selection.anchor.offset;
  const match = /(?:^|[\s([{])\/([a-z]*)$/i.exec(node.getTextContent().slice(0, end));
  if (!match || !"link".startsWith(match[1].toLocaleLowerCase())) return null;
  const start = end - match[1].length - 1;
  // Formatting can split a path into adjacent text nodes. It is still not a command.
  const preceding = start === 0 ? node.getPreviousSibling()?.getTextContent().at(-1) : undefined;
  if (preceding && !/[\s([{]/.test(preceding)) return null;
  return { key: node.getKey(), query: match[1], start, end };
}

/** Delete only the command token. The dialog inserts its link at this exact caret. */
export function $removeInlineLinkQuery(expected: InlineLinkQuery): boolean {
  const current = $inlineLinkQuery();
  if (!current || current.key !== expected.key || current.start !== expected.start || current.end !== expected.end || current.query !== expected.query) return false;
  const node = $getNodeByKey(current.key);
  if (!$isTextNode(node)) return false;
  node.select(current.start, current.end).removeText();
  return true;
}

/** Raw frontmatter is outside the block editor's editable body. Source mode can still edit it. */
export function markdownFrontmatter(source: string): { prefix: string; body: string } {
  const match = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(source);
  return match ? { prefix: match[0], body: source.slice(match[0].length) } : { prefix: "", body: source };
}

export function preserveMarkdownFrontmatter(previous: string, next: string): string {
  const original = markdownFrontmatter(previous);
  if (!original.prefix) return next;
  return original.prefix + markdownFrontmatter(next).body;
}
