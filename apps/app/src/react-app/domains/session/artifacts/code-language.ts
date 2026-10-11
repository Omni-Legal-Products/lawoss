/** Kept separate from the editor so file discovery does not load its parsers. */
const languages: Record<string, string> = {
  js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", jsx: "JSX",
  ts: "TypeScript", mts: "TypeScript", cts: "TypeScript", tsx: "TSX",
  py: "Python", pyw: "Python", json: "JSON", jsonc: "JSONC",
  yaml: "YAML", yml: "YAML", css: "CSS", scss: "SCSS", sass: "Sass",
  html: "HTML", htm: "HTML", xml: "XML", sql: "SQL",
  sh: "Shell", bash: "Shell", zsh: "Shell", toml: "TOML",
};

export function codeLanguage(path: string): string | null {
  const name = path.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? "";
  return languages[name.split(".").at(-1) ?? ""] ?? null;
}
