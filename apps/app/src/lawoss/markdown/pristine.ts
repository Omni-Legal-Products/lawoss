/** Exact source bytes and their canonical MDXEditor representation. */
export type PristineMarkdown = { source: string; normalized: string };

/** Restore exact imported bytes only in rich text; source/diff edits stay literal. */
export function restorePristineMarkdown(markdown: string, pristine: PristineMarkdown | null, viewMode: string): string {
  if (viewMode !== "rich-text" || !pristine) return markdown;
  return markdown === pristine.normalized ? pristine.source : markdown;
}
