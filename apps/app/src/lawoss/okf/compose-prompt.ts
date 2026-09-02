/**
 * Fáza A: dialóg nič nezakladá sám. Zloží požiadavku pre agenta, ktorý cez
 * skill /novy-spis zavolá okf CLI a plán ukáže advokátovi. Čistá funkcia,
 * aby sa dala otestovať bez React-u.
 */
import type { EntityType } from "../../../../../lawoss/okf/src/core";

export type Jurisdikcia = "SK" | "CZ";
export type SubjectKind = "pravnicka-osoba" | "fyzicka-osoba" | "spis" | "projekt";

export type NovySpisForm = {
  mode: "okf" | "plain";
  subject: SubjectKind;
  title: string;
  ico: string;
  jurisdikcia: Jurisdikcia;
  verify: boolean;
  /** Absolútna cesta koreňa, pod ktorým má entita vzniknúť (workspace root). */
  root: string;
  protistrana: string;
};

export function entityTypeFor(subject: SubjectKind): EntityType {
  if (subject === "spis") return "spis";
  if (subject === "projekt") return "projekt";
  return "klient";
}

export function targetDir(form: NovySpisForm): string {
  const title = form.title.trim() || "[názov]";
  const root = form.root.replace(/[\\/]+$/, "");
  return root ? `${root}/${title}` : title;
}

export function composePrompt(form: NovySpisForm): string {
  const type = entityTypeFor(form.subject);
  const dir = targetDir(form);
  const lines: string[] = [];
  lines.push(`Použi skill /novy-spis. Založ ${type === "klient" ? "klienta" : type} podľa OKF.`);
  lines.push("");
  lines.push(`- typ: ${type}`);
  lines.push(`- názov: ${form.title.trim() || "[doplň názov]"}`);
  if (form.ico.trim()) lines.push(`- IČO: ${form.ico.trim()}`);
  if (form.protistrana.trim()) lines.push(`- protistrana: ${form.protistrana.trim()}`);
  lines.push(`- jurisdikcia: ${form.jurisdikcia === "SK" ? "Slovensko" : "Česko"}`);
  lines.push(`- cieľový priečinok: ${dir}`);
  lines.push("");
  if (form.verify && form.subject === "pravnicka-osoba") {
    lines.push(
      form.jurisdikcia === "SK"
        ? "Najprv over subjekt v ORSR a RPO cez MCP (IČO, sídlo, štatutár, stav) a údaje z registra použi v karte."
        : "Najprv over subjekt v obchodnom rejstříku cez dostupné MCP alebo web a do karty zapíš zdroj.",
    );
  }
  lines.push("Spusť `okf detect` a `okf plan`, ukáž mi plán a čakaj na moje potvrdenie. `apply` až po ňom, potom `validate` a `render`.");
  return lines.join("\n");
}
