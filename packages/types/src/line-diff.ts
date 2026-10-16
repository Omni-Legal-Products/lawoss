export type LineChanges = { added: number; removed: number };

/** Exact line counts with bounded work, including empty files and trailing newlines. */
export function lineChanges(before: string, after: string): LineChanges | null {
  const lines = (text: string) => text ? text.replace(/\r\n/g, "\n").match(/[^\n]*\n|[^\n]+$/g) ?? [] : [];
  const a = lines(before), b = lines(after);
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const removed = endA - start, added = endB - start;
  if (!removed || !added) return { added, removed };
  // Avoid blocking the UI/server on unusually large, completely rewritten pages.
  if (removed * added > 4_000_000) return null;
  const row = new Uint32Array(added + 1);
  for (let i = start; i < endA; i++) {
    let diagonal = 0;
    for (let j = 1; j <= added; j++) {
      const previous = row[j];
      row[j] = a[i] === b[start + j - 1] ? diagonal + 1 : Math.max(row[j], row[j - 1]);
      diagonal = previous;
    }
  }
  return { added: added - row[added], removed: removed - row[added] };
}
