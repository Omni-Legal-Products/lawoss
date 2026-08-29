/**
 * okf-memory — CLI nad pamäťovým jadrom.
 *
 * Zápis je zámerne opt-in: bez `--apply` je každý príkaz iba náhľad.
 * Hranica nie je v prompte, ale v nástroji — agent, ktorý zabudne `--apply`,
 * nič neprepíše.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readStore, writeIndex, syncStatus, ensureBrain } from "./store.ts";
import { renderStatus } from "./render.ts";
import { validateStore } from "./validate.ts";

export interface CliResult {
  readonly code: number;
  readonly out: string;
}

const USAGE = [
  "okf-memory — pamäť spisu (OKF)",
  "",
  "  okf-memory read     <spis>            prehľad pamäte",
  "  okf-memory validate <spis>            kontrola schémy, únikov L2→L3 a odkazov",
  "  okf-memory sync     <spis> [--apply]  projekcia do _STATUS.md a INDEX.md",
  "  okf-memory init     <spis> [--sk] [--apply]   BRAIN.md a adresár pamäte",
  "",
  "Bez --apply sa nič nezapisuje.",
].join("\n");

function ok(out: string): CliResult {
  return { code: 0, out };
}

/** Slovenské a české skloňovanie po číslovke: 1 riadok, 2–4 riadky, 5+ riadkov. */
function riadkov(n: number): string {
  if (n === 1) return "1 riadok";
  if (n >= 2 && n <= 4) return `${n} riadky`;
  return `${n} riadkov`;
}

/** 1 záznam, 2–4 záznamy, 5+ záznamov. */
function zaznamov(n: number): string {
  if (n === 1) return "1 záznam";
  if (n >= 2 && n <= 4) return `${n} záznamy`;
  return `${n} záznamov`;
}

export function runCli(argv: readonly string[]): CliResult {
  const [cmd, dir, ...rest] = argv;
  const apply = rest.includes("--apply");
  const jurisdiction = rest.includes("--sk") ? "sk" : "cz";

  if (!cmd || !dir) return { code: 2, out: USAGE };
  if (!existsSync(dir)) return { code: 2, out: `Cesta neexistuje: ${dir}\n\n${USAGE}` };

  switch (cmd) {
    case "read": {
      const s = readStore(dir);
      const lines = [
        `Spis: ${dir}`,
        `Jurisdikcia: ${s.jurisdiction}   Záznamov: ${s.records.length}`,
        "",
        ...s.records.map((r) => `  ${r.id.padEnd(8)} ${r.layer}  ${r.type.padEnd(10)} ${r.summary}`),
      ];
      return ok(lines.join("\n"));
    }

    case "validate": {
      const findings = validateStore(readStore(dir).records);
      if (findings.length === 0) return ok("OK — pamäť je konzistentná.");
      const lines = findings.map((f) => `${f.severity.toUpperCase()} ${f.code} ${f.recordId}: ${f.message}`);
      const hasError = findings.some((f) => f.severity === "error");
      return { code: hasError ? 1 : 0, out: lines.join("\n") };
    }

    case "sync": {
      const s = readStore(dir);
      if (!apply) {
        const statusPath = join(dir, "_STATUS.md");
        const before = existsSync(statusPath) ? readFileSync(statusPath, "utf8") : "";
        const after = renderStatus(before, s.records, s.jurisdiction);
        const zmena = before === after ? "bez zmeny" : "_STATUS.md by sa zmenil";
        return ok(`dry-run: ${zmena}; INDEX.md by dostal ${riadkov(s.records.length)}. Zapíš s --apply.`);
      }
      syncStatus(dir);
      writeIndex(dir);
      return ok(`Zapísané: _STATUS.md a INDEX.md (${zaznamov(s.records.length)}).`);
    }

    case "init": {
      if (!apply) return ok(`dry-run: založil by som BRAIN.md a adresár pamäte (${jurisdiction}). Zapíš s --apply.`);
      ensureBrain(dir, jurisdiction);
      return ok(`Založené: BRAIN.md (${jurisdiction}).`);
    }

    default:
      return { code: 2, out: `Neznámy príkaz: ${cmd}\n\n${USAGE}` };
  }
}
