/** Frontmatter medzi prvými dvoma `---`; iba jednoduché `key: value`. */
export function parseFrontmatter(text: string): Record<string, string> | null {
  // Windows: karta uložená ako „UTF-8 s BOM“ (Poznámkový blok, PowerShell 5.1) začína U+FEFF.
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0] !== "---") return null;
  const out: Record<string, string> = {};
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === "---") return out;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (match) {
      const value = match[2].trim();
      if (value.startsWith('"')) {
        try {
          const decoded: unknown = JSON.parse(value);
          if (typeof decoded !== "string") return null;
          out[match[1]] = decoded;
        } catch { return null; }
      } else out[match[1]] = value;
    }
  }
  return null; // neuzavretý frontmatter
}
