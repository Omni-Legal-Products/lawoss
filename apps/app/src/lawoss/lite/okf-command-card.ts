/**
 * LAWOSS: čitateľná karta pre príkazy skillu /novy-spis (overenie alfy 14. 11. 2026, test 15). Nový prípad vetou
 * ukázal päť kariet „Spustiť príkaz v počítači?“ s kódom `node …/okf.js plan|apply|validate|render` a
 * `node …/okf-memory.js init|validate`. V režime Lite karta povie po ľudsky, čo sa stane a kde („Založiť prípad?“,
 * názov, klient, protistrana, druh, priečinok); surový príkaz ostáva v zbalených Podrobnostiach.
 *
 * Iba zobrazenie: nemení povolenie, jeho rozsah ani tlačidlá (príkaz stále beží v počítači a jedno schválenie pokrýva
 * všetko, čo urobí). Rozpoznanie je prísne ako pri `describeMemoryWrite`: príkaz musí byť PRESNE jeden alebo viac krokov
 * spojených holým `&&`, každý krok jeden známy tvar s povolenými prepínačmi, bez opakovaného prepínača, bez prebytočného
 * slova, bez neviditeľných znakov v hodnotách a s rovnakým priečinkom prípadu vo všetkých krokoch. Čokoľvek iné vráti
 * `null` a ostane doterajšia karta s príkazom. Hodnoty z príkazu (názvy, mená) sú dáta: karta ich ukáže v úvodzovkách
 * ako text, nikdy ako pokyn.
 */
import { t } from "@/i18n";
import type { FileOperationDetails } from "./file-operation-card";
import { shellWords, type ShellWord } from "./memory-write";

const RUNTIMES = new Set(["node", "bun", "node.exe", "bun.exe"]);
/** Neviditeľné a formátovacie znaky (obrátenie smeru textu, nulová šírka) a oddeľovače riadkov: hodnota by na karte klamala. */
const HIDDEN_CHARS = /[\p{Cf}\p{Zl}\p{Zp}]/u;

/** Prepínače `okf plan|apply`, ktoré CLI číta s hodnotou (`lawoss/okf/src/cli.ts` `inputFrom`). */
const VALUE_FLAGS = ["title", "klient", "protistrana", "protistrana-ico", "ico", "oblast", "desc", "spzn", "sud", "advokat", "client-type", "country",
  "citizenship", "residence-country", "identifier-type", "identifier", "matter-kind", "mode", "language", "date"] as const;
type ValueFlag = (typeof VALUE_FLAGS)[number];
/** Statické kľúče prekladu (audit i18n neprijme kľúč skladaný za behu). */
const KIND_KEYS = { dispute: "lawoss.okf_command.kind_dispute", advisory: "lawoss.okf_command.kind_advisory",
  transaction: "lawoss.okf_command.kind_transaction", other: "lawoss.okf_command.kind_other" } as const;
const MODE_KEYS = { bounded: "lawoss.okf_command.mode_bounded", ongoing: "lawoss.okf_command.mode_ongoing" } as const;
const JURISDICTION_KEYS = { sk: "lawoss.okf_command.jurisdiction_sk", cz: "lawoss.okf_command.jurisdiction_cz" } as const;
const HEADINGS = {
  apply_case: ["lawoss.okf_command.title_apply_case", "lawoss.okf_command.message_apply_case"],
  apply_client: ["lawoss.okf_command.title_apply_client", "lawoss.okf_command.message_apply_client"],
  memory_init: ["lawoss.okf_command.title_memory_init", "lawoss.okf_command.message_memory_init"],
  render: ["lawoss.okf_command.title_render", "lawoss.okf_command.message_render"],
  plan_case: ["lawoss.okf_command.title_plan_case", "lawoss.okf_command.message_plan_case"],
  plan_client: ["lawoss.okf_command.title_plan_client", "lawoss.okf_command.message_plan_client"],
  check: ["lawoss.okf_command.title_check", "lawoss.okf_command.message_check"],
} as const;
const known = <T extends object>(map: T, key: string | undefined): key is Extract<keyof T, string> => key !== undefined && Object.hasOwn(map, key);

type Entity = "spis" | "klient";
type Step =
  | { tool: "okf"; cmd: "plan" | "apply"; entity: Entity; dir: string; values: Map<ValueFlag, string>; jurisdiction?: "sk" | "cz" }
  | { tool: "okf"; cmd: "validate" | "render" | "detect"; dir: string }
  | { tool: "memory"; cmd: "init"; dir: string; apply: boolean }
  | { tool: "memory"; cmd: "validate"; dir: string };

/**
 * Len skript skillu nainštalovaného v priečinku klienta, relatívne k nemu: `.opencode/skills/<skill>/resources/<file>`
 * (oddeľovač `/` aj `\`). Absolútna cesta sa nerozpozná: kópia skriptu inde (napr. v pracovnom priečinku) by inak dostala
 * čitateľnú kartu. Ostáva to, čo pri `describeMemoryWrite`: zhoda podľa cesty, nie obsahu, a voči pracovnému priečinku príkazu.
 */
function isSkillScript(token: string, skill: string, file: string): boolean {
  const parts = token.split(/[\\/]/);
  return parts.length === 5 && parts[0] === ".opencode" && parts[1] === "skills" && parts[2] === skill && parts[3] === "resources" && parts[4] === file;
}

const isFlag = (word: string) => word.startsWith("--");
const plain = (value: string) => value.length > 0 && !HIDDEN_CHARS.test(value);

/** `<dir> [--json]` alebo `<dir>` bez prepínačov. */
function dirOnly(args: string[], json: boolean): string | null {
  const [dir, ...rest] = args;
  if (!dir || isFlag(dir) || !plain(dir)) return null;
  if (rest.length === 0 || (json && rest.length === 1 && rest[0] === "--json")) return dir;
  return null;
}

/** `plan|apply <spis|klient> <dir> [prepínače]` presne tak, ako ho prečíta CLI; inak `null`. */
function planOrApply(cmd: "plan" | "apply", args: string[]): Step | null {
  const [entity, dir, ...rest] = args;
  if ((entity !== "spis" && entity !== "klient") || !dir || isFlag(dir) || !plain(dir)) return null;
  const values = new Map<ValueFlag, string>();
  const seen = new Set<string>();
  let sk = false, cz = false;
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i]!;
    if (!isFlag(word) || seen.has(word)) return null; // prebytočné slovo alebo opakovaný prepínač (CLI berie posledný)
    seen.add(word);
    const name = word.slice(2);
    const next = rest[i + 1];
    if (name === "sk" || name === "cz" || name === "json") {
      // CLI by slovo za prepínačom bez hodnoty vzalo ako jeho hodnotu.
      if (next !== undefined && !isFlag(next)) return null;
      if (name === "sk") sk = true; else if (name === "cz") cz = true;
      continue;
    }
    const flag = VALUE_FLAGS.find((known) => known === name);
    if (!flag || next === undefined || isFlag(next) || !plain(next)) return null;
    values.set(flag, next);
    i++;
  }
  if (sk && cz) return null;
  // #415: spis bez --sk/--cz je platný, CLI vezme jurisdikciu z karty klienta alebo kancelárie; karta ju vtedy neuvádza.
  const kind = values.get("matter-kind"), mode = values.get("mode");
  if (kind !== undefined && !known(KIND_KEYS, kind)) return null;
  if (mode !== undefined && !known(MODE_KEYS, mode)) return null;
  return { tool: "okf", cmd, entity, dir, values, ...(sk ? { jurisdiction: "sk" as const } : cz ? { jurisdiction: "cz" as const } : {}) };
}

function okfStep(args: string[]): Step | null {
  const [cmd, ...rest] = args;
  if (cmd === "plan" || cmd === "apply") return planOrApply(cmd, rest);
  if (cmd === "validate" || cmd === "render" || cmd === "detect") {
    const dir = dirOnly(rest, true);
    return dir ? { tool: "okf", cmd, dir } : null;
  }
  return null;
}

function memoryStep(args: string[]): Step | null {
  const [cmd, dir, ...rest] = args;
  if (!dir || isFlag(dir) || !plain(dir)) return null;
  if (cmd === "init" && rest.length <= 1 && (rest.length === 0 || rest[0] === "--apply")) return { tool: "memory", cmd, dir, apply: rest.length === 1 };
  if (cmd === "validate" && rest.length === 0) return { tool: "memory", cmd, dir };
  return null;
}

/** Jeden krok: `node|bun <skript skillu> <príkaz> …`. Holý `okf`/`okf-memory` z PATH sa nerozpozná. */
function step(words: string[]): Step | null {
  const [runtime, script, ...args] = words;
  if (!runtime || !RUNTIMES.has(runtime) || !script) return null;
  if (isSkillScript(script, "novy-spis", "okf.js")) return okfStep(args);
  if (isSkillScript(script, "okf-pamat", "okf-memory.js")) return memoryStep(args);
  return null;
}

/** Kroky spojené holým `&&`; slovo `&&` v úvodzovkách je dáta. Prázdny krok (`&& &&`) nie je tvar skillu. */
function steps(command: string): Step[] | null {
  const words = shellWords(command, new Set(["&&"]));
  if (!words || words.length === 0) return null;
  const groups: ShellWord[][] = [[]];
  for (const word of words) {
    if (!word.quoted && word.text === "&&") groups.push([]);
    else groups[groups.length - 1]!.push(word);
  }
  const parsed: Step[] = [];
  for (const group of groups) {
    if (group.length === 0) return null;
    const found = step(group.map((word) => word.text));
    if (!found) return null;
    parsed.push(found);
  }
  return parsed;
}

export type OkfCommandCard = { title: string; message: string; scopeLabel: string; scopeValue: string; details: FileOperationDetails };

const quoted = (value: string) => t("lawoss.okf_command.quoted", undefined, { text: value });
const folder = (dir: string) => dir === "." || dir === "./" ? t("lawoss.okf_command.this_folder") : dir;

/** Údaje plánu alebo zápisu: hlavné po ľudsky, ostatné prepínače ako „Ďalší údaj (--x): „…““. Nič sa nevynechá. */
function identityLines(main: Extract<Step, { cmd: "plan" | "apply" }>): string[] {
  const value = (flag: ValueFlag) => main.values.get(flag);
  const title = value("title"), kind = value("matter-kind"), mode = value("mode");
  const lines = [
    ...(title ? [t(main.entity === "spis" ? "lawoss.okf_command.case_title" : "lawoss.okf_command.client_title", undefined, { text: quoted(title) })] : []),
    ...(main.entity === "spis" && value("klient") ? [t("lawoss.okf_command.client", undefined, { text: quoted(value("klient")!) })] : []),
    ...(value("protistrana") ? [t("lawoss.okf_command.counterparty", undefined, { text: quoted(value("protistrana")!) })] : []),
    ...(known(KIND_KEYS, kind) ? [t("lawoss.okf_command.kind", undefined, { text: t(KIND_KEYS[kind]) })] : []),
    ...(known(MODE_KEYS, mode) ? [t("lawoss.okf_command.mode", undefined, { text: t(MODE_KEYS[mode]) })] : []),
    ...(main.jurisdiction ? [t("lawoss.okf_command.jurisdiction", undefined, { text: t(JURISDICTION_KEYS[main.jurisdiction]) })] : []),
    t("lawoss.okf_command.folder", undefined, { path: main.dir }),
  ];
  const shown = new Set<ValueFlag>(["title", "protistrana", "matter-kind", "mode", ...(main.entity === "spis" ? ["klient" as const] : [])]);
  for (const [flag, text] of main.values) if (!shown.has(flag)) lines.push(t("lawoss.okf_command.other_value", undefined, { flag: `--${flag}`, text: quoted(text) }));
  return lines;
}

/** Čo urobí každý krok, v poradí príkazu. */
function stepLine(item: Step): string {
  if (item.tool === "memory") {
    if (item.cmd === "validate") return t("lawoss.okf_command.step_memory_validate", undefined, { path: folder(item.dir) });
    return t(item.apply ? "lawoss.okf_command.step_memory_init" : "lawoss.okf_command.step_memory_init_preview", undefined, { path: folder(item.dir) });
  }
  if (item.cmd === "plan") return t(item.entity === "spis" ? "lawoss.okf_command.step_plan_case" : "lawoss.okf_command.step_plan_client");
  if (item.cmd === "apply") return t(item.entity === "spis" ? "lawoss.okf_command.step_apply_case" : "lawoss.okf_command.step_apply_client", undefined, { path: folder(item.dir) });
  if (item.cmd === "validate") return t("lawoss.okf_command.step_validate", undefined, { path: folder(item.dir) });
  if (item.cmd === "detect") return t("lawoss.okf_command.step_detect", undefined, { path: folder(item.dir) });
  return t("lawoss.okf_command.step_render", undefined, { path: folder(item.dir) });
}

const writes = (item: Step) => (item.tool === "okf" && (item.cmd === "apply" || item.cmd === "render")) || (item.tool === "memory" && item.cmd === "init" && item.apply);

/** Nadpis a veta karty podľa najsilnejšieho kroku: zápis prípadu, založenie pamäte, obnova prehľadu, alebo len čítanie. */
function heading(list: Step[], main: Extract<Step, { cmd: "plan" | "apply" }> | undefined): { title: string; message: string } {
  const pick = (key: keyof typeof HEADINGS) => ({ title: t(HEADINGS[key][0]), message: t(HEADINGS[key][1]) });
  if (main?.cmd === "apply") return pick(main.entity === "spis" ? "apply_case" : "apply_client");
  if (list.some((item) => item.tool === "memory" && item.cmd === "init" && item.apply)) return pick("memory_init");
  if (list.some(writes)) return pick("render");
  if (main?.cmd === "plan") return pick(main.entity === "spis" ? "plan_case" : "plan_client");
  return pick("check");
}

/**
 * Čitateľná karta pre príkaz skillov /novy-spis a /okf-pamat (zakladanie prípadu), alebo `null`, keď príkaz nie je
 * presne taký tvar. Pri `plan` alebo `apply` musia všetky kontroly a pamäť bežať v tom istom priečinku prípadu;
 * `render` smie obnoviť nadradený priečinok klienta. `plan` a `apply` v jednom príkaze sa nespájajú.
 */
export function okfCommandCard(command: string): OkfCommandCard | null {
  try {
    const list = steps(command);
    if (!list) return null;
    const mains = list.filter((item): item is Extract<Step, { cmd: "plan" | "apply" }> => item.tool === "okf" && (item.cmd === "plan" || item.cmd === "apply"));
    if (mains.length > 1) return null;
    const main = mains[0];
    const caseDirs = new Set(list.filter((item) => !(item.tool === "okf" && item.cmd === "render")).map((item) => item.dir));
    if (caseDirs.size > 1) return null; // karta by ukázala iný priečinok, než do ktorého niektorý krok zasiahne
    const lines = [...(main ? identityLines(main) : []), ...list.map(stepLine)];
    return {
      ...heading(list, main),
      scopeLabel: t("lawoss.okf_command.scope"),
      scopeValue: lines.join("\n"),
      details: { reason: null, lines: [...lines, t("lawoss.okf_command.raw_command", undefined, { text: command })] },
    };
  } catch {
    return null;
  }
}
