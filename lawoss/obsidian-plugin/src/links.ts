/** Resolve only explicit existing local files; no title-based guessing or remote loading. */
export function resolveLocalLink(link: string, from: string, roots: readonly string[], exists: (p: string) => boolean): string | null {
  if (!link || link.startsWith('!') || /[\\:\u0000-\u001f]/.test(link) || link.startsWith('/')) return null;
  let value = link;
  const wiki = value.startsWith('[[') && value.endsWith(']]');
  if (wiki) value = value.slice(2, -2).split('|')[0] ?? '';
  value = value.split('#')[0] ?? '';
  try { value = decodeURIComponent(value); } catch { return null; }
  if (!value || /[\\:\u0000-\u001f]/.test(value) || value.startsWith('/') || /%2f|%5c/i.test(link)) return null;
  const relative = from.split('/').slice(0, -1).concat(value.split('/')).join('/');
  const paths = wiki ? [relative, value] : [relative];
  for (const path of paths) {
    const parts: string[] = [];
    for (const part of path.split('/')) {
      if (part === '..') { if (!parts.length) return null; parts.pop(); }
      else if (part && part !== '.') parts.push(part);
    }
    if (parts.some(p => p.startsWith('.'))) return null;
    const normalized = parts.join('/').normalize('NFC');
    for (const candidate of wiki && !/\.[^/]+$/.test(normalized) ? [normalized, normalized + '.md'] : [normalized]) {
      if (roots.some(root => root === '' || candidate.startsWith(root.normalize('NFC') + '/')) && exists(candidate)) return candidate;
    }
  }
  return null;
}
