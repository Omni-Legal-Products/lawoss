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

/**
 * Cieľový priečinok = koreň + JEDEN segment z názvu veci. Spisová značka má
 * vždy lomítko (`MSPH 79 INS 1/2026`) — bez sanitizácie by sa ročník stal
 * ďalšou adresárovou úrovňou a `..` by ušlo mimo koreň. Názov veci v karte
 * ostáva pôvodný, mení sa iba názov priečinka. Úvodné bodky preč: `.` by bol
 * koreň sám a `.názov` skrytý priečinok, ktorý `okf` pri prehľadávaní preskočí.
 */
export function targetDir(form: NovySpisForm): string {
  const name = form.title.replace(/[\\/]+/g, "-").replace(/\.{2,}/g, "-").replace(/^[\s.]+|\s+$/g, "") || "[názov]";
  const root = form.root.replace(/[\\/]+$/, "");
  return root ? `${root}/${name}` : name;
}

/** Prepínač jurisdikcie pre `okf` CLI. Strojová hodnota je malými písmenami. */
export function jurisdictionFlag(form: Pick<NovySpisForm, "jurisdikcia">): string {
  return form.jurisdikcia === "SK" ? "--sk" : "--cz";
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
  // Jurisdikciu treba dvakrát: raz ľudsky pre agenta, raz ako prepínač, ktorý
  // skončí v karte veci. `okf-pamat` ju z karty číta a bez nej pamäť spisu
  // nezaloží — advokát ju v dialógu vybral, nesmie sa cestou stratiť.
  lines.push(`- jurisdikcia: ${form.jurisdikcia === "SK" ? "Slovensko" : "Česko"} (prepínač \`${jurisdictionFlag(form)}\`)`);
  lines.push(`- cieľový priečinok: ${dir}`);
  lines.push("");
  if (form.verify && form.subject === "pravnicka-osoba") {
    lines.push(
      form.jurisdikcia === "SK"
        ? "Najprv over subjekt v ORSR a RPO cez MCP (IČO, sídlo, štatutár, stav) a údaje z registra použi v karte."
        : "Najprv over subjekt v obchodnom rejstříku cez dostupné MCP alebo web a do karty zapíš zdroj.",
    );
  }
  lines.push(
    `Spusť \`okf detect\` a \`okf plan ${type} "${dir}" --title "${form.title.trim()}" ${jurisdictionFlag(form)}\`, ` +
      "ukáž mi plán a čakaj na moje potvrdenie. `apply` s rovnakými argumentmi až po ňom, potom `validate` a `render`.",
  );
  return lines.join("\n");
}
