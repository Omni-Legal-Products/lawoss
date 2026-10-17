import { describe, expect, test } from "bun:test";
import { LanguageSupport } from "@codemirror/language";
import { codeLanguage } from "../src/react-app/domains/session/artifacts/code-language";
import { codeDiagnostics, codeLanguageSupport } from "../src/react-app/domains/session/artifacts/code-editor-language";
import { classifyOpenTarget, isCollectibleArtifactTarget } from "../src/react-app/domains/session/artifacts/open-target";

function diagnostics(path: string, content: string) {
  const name = codeLanguage(path);
  const support = codeLanguageSupport(name);
  if (!name || !support) throw new Error(`Missing bundled grammar: ${path}`);
  return codeDiagnostics(content, name, support instanceof LanguageSupport ? support.language : support);
}

describe("bundled code editor", () => {
  test("recognizes language variants and opens verified code in tabs", () => {
    for (const path of ["src/app.TSX", "C:\\src\\index.MJS", "types.cts", "script.py", "config.yaml", "query.sql", "run.sh", "pyproject.toml", "style.scss"]) {
      expect(codeLanguageSupport(codeLanguage(path))).not.toBeNull();
      const preview = classifyOpenTarget(path, "file");
      expect(preview).toBe("text");
      expect(isCollectibleArtifactTarget({ id: path, kind: "file", name: path, value: path, preview, exists: true, confidence: 100, reason: "test" })).toBe(true);
    }
    expect(classifyOpenTarget("page.html", "file")).toBe("html");
    expect(classifyOpenTarget("image.png", "file")).toBe("image");
    expect(classifyOpenTarget("archive.zip", "file")).toBe("external");
    expect(codeLanguage("notes.txt")).toBeNull();
  });

  test("valid language constructs do not receive syntax errors", () => {
    for (const [path, source] of [
      ["index.js", "export const name = 'LegalWork';"],
      ["index.ts", "interface Matter { id: string }; const matter: Matter = { id: '123' };"],
      ["view.tsx", "export const View = ({ name }: { name: string }) => <div>{name}</div>;"],
      ["view.jsx", "export const View = () => <div>Hello</div>;"],
      ["task.py", "def run(name):\n    return f'Hello {name}'\n"],
      ["config.json", '{"name": "LegalWork", "enabled": true}'],
      ["config.jsonc", '{ // comment\n "name": "LegalWork",\n}'],
      ["config.yaml", "name: LegalWork\nitems:\n  - one\n  - two\n"],
      ["style.css", ".panel { color: red; }"],
      ["style.scss", "$color: red; .panel { color: $color; }"],
      ["data.xml", '<matter id="123"><name>Review</name></matter>'],
      ["page.html", "<main><h1>Hello</h1></main>"],
    ]) expect(diagnostics(path, source)).toEqual([]);
  });

  test("reports invalid syntax with bounded editor ranges and clears after correction", () => {
    for (const [path, source] of [["index.ts", "const = ;"], ["task.py", "def :\n"], ["config.json", '{"name": }']]) {
      const errors = diagnostics(path, source);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.every(error => error.from >= 0 && error.to >= error.from && error.to <= source.length)).toBe(true);
    }
    expect(diagnostics("config.json", '{"name": "fixed"}')).toEqual([]);
  });

  test("JSONC permits comments and trailing commas while JSON rejects them", () => {
    const source = '{ // name\n "name": "LegalWork",\n}';
    expect(diagnostics("config.json", source).length).toBeGreaterThan(0);
    expect(diagnostics("config.jsonc", source)).toEqual([]);
    expect(diagnostics("config.jsonc", '{ "name": }').length).toBeGreaterThan(0);
  });
});
