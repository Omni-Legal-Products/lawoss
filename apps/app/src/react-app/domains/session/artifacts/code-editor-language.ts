import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { sass } from "@codemirror/lang-sass";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage, type Language, type LanguageSupport } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import type { Diagnostic } from "@codemirror/lint";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { t } from "@/i18n";

// Static package imports only: every grammar and diagnostic runs in the app,
// including packaged Electron builds with no internet connection.
export function codeLanguageSupport(name: string | null): LanguageSupport | Language | null {
  switch (name) {
    case "JavaScript": return javascript();
    case "JSX": return javascript({ jsx: true });
    case "TypeScript": return javascript({ typescript: true });
    case "TSX": return javascript({ typescript: true, jsx: true });
    case "JSON": return json();
    case "JSONC": return javascript();
    case "Python": return python();
    case "CSS": return css();
    case "SCSS": return sass();
    case "Sass": return sass({ indented: true });
    case "HTML": return html();
    case "XML": return xml();
    case "YAML": return yaml();
    case "SQL": return sql();
    case "Shell": return StreamLanguage.define(shell);
    case "TOML": return StreamLanguage.define(toml);
    default: return null;
  }
}

export function hasCodeDiagnostics(name: string | null) {
  return name !== null && !["Shell", "TOML", "SQL"].includes(name);
}

export function codeDiagnostics(content: string, name: string, language: Language): Diagnostic[] {
  if (name === "JSON" || name === "JSONC") {
    const errors: ParseError[] = [];
    parse(content, errors, { disallowComments: name === "JSON", allowTrailingComma: name === "JSONC" });
    return errors.map(error => ({
      from: error.offset, to: Math.min(content.length, error.offset + error.length), severity: "error",
      message: `${t("code_editor.syntax_error")}: ${printParseErrorCode(error.error).replace(/([a-z])([A-Z])/g, "$1 $2")}`,
    }));
  }
  const diagnostics: Diagnostic[] = [];
  language.parser.parse(content).iterate({ enter(node) {
    if (!node.type.isError) return;
    diagnostics.push({ from: node.from, to: node.to, severity: "error", message: t("code_editor.syntax_error") });
  } });
  return diagnostics;
}
