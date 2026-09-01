/**
 * okf-memory — CLI nad pamäťovým jadrom.
 *
 * Zápis je zámerne opt-in: bez `--apply` je každý príkaz iba náhľad.
 * Hranica nie je v prompte, ale v nástroji — agent, ktorý zabudne `--apply`,
 * nič neprepíše.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readStore, readScope, writeIndex, syncStatus, ensureBrain, applyRecordWrite } from "./store.ts";
import { parseRecord, type OkfRecord } from "./record.ts";
import { planWrite, type Approval, type WriteDiff } from "./write.ts";
import { maskRecord } from "./mask.ts";
import { fieldLabel } from "./schema.ts";
import { renderStatus, RenderConflictError } from "./render.ts";
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
  "  okf-memory aml      <spis>            subjekty a stav AML preverenia",
  "  okf-memory write    <spis> --file <záznam.md> --reason \"…\" [--apply] [--approve-as \"meno\"]",
  "  okf-memory init     <spis> [--sk] [--apply]   BRAIN.md a adresár pamäte",
  "",
  "Bez --apply sa nič nezapisuje.",
].join("\n");

/** Hodnota prepínača s hodnotou: `--file cesta`. Chýbajúca hodnota nie je hodnota. */
function flagValue(rest: readonly string[], name: string): string | undefined {
  const i = rest.indexOf(name);
  if (i === -1) return undefined;
  const v = rest[i + 1];
  return v === undefined || v.startsWith("--") ? undefined : v;
}

function ok(out: string): CliResult {
  return { code: 0, out };
}

/** Slovenské a české skloňovanie po číslovke: 1 riadok, 2–4 riadky, 5+ riadkov. */
function problemLines(problems: readonly { file: string; message: string }[]): string[] {
  if (problems.length === 0) return [];
  return [
    "Nečitateľné súbory (preskočené):",
    ...problems.map((p) => `  ERROR PARSE ${p.file}: ${p.message}`),
    "",
  ];
}

function riadkov(n: number): string {
  if (n === 1) return "1 riadok";
  if (n >= 2 && n <= 4) return `${n} riadky`;
  return `${n} riadkov`;
}

/** Slovenčina skloňuje: „Nový záznam", ale „Zmena záznamu". */
function nadpisZapisu(kind: WriteDiff["kind"]): string {
  if (kind === "create") return "Nový záznam";
  if (kind === "delete") return "Zmazanie záznamu";
  return "Zmena záznamu";
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
      const scope = readScope(dir);
      const lines = [
        ...problemLines(scope.problems),
        `Spis: ${dir}`,
        `Jurisdikcia: ${scope.matter.jurisdiction}   Záznamov: ${scope.records.length}` +
          (scope.clientDir ? ` (z toho ${scope.clientRecords.length} u klienta)` : ""),
        "",
        ...scope.records
          .map(maskRecord)
          .map((r) => `  ${r.id.padEnd(8)} ${r.layer}  ${r.type.padEnd(10)} ${r.summary}`),
      ];
      return ok(lines.join("\n"));
    }

    case "validate": {
      const scope = readScope(dir);
      const findings = validateStore(scope.records);
      const problems = problemLines(scope.problems);
      if (findings.length === 0 && problems.length === 0) {
        return ok("OK — pamäť je konzistentná.");
      }
      const lines = [
        ...problems,
        ...findings.map((f) => `${f.severity.toUpperCase()} ${f.code} ${f.recordId}: ${f.message}`),
      ];
      const hasError = scope.problems.length > 0 || findings.some((f) => f.severity === "error");
      return { code: hasError ? 1 : 0, out: lines.join("\n") };
    }

    case "sync": {
      const s = readStore(dir);
      try {
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
      } catch (e) {
        // Konflikt sekcií je stav spisu, nie chyba programu — advokát dostane
        // vetu, čo urobiť, nie výpis interpretu.
        if (e instanceof RenderConflictError) return { code: 1, out: `KONFLIKT: ${e.message}` };
        throw e;
      }
    }

    case "aml": {
      const scope = readScope(dir);
      const subjekty = scope.records.filter((r) => r.type === "subject");
      const preverenia = scope.records.filter((r) => r.type === "screening");
      const findings = validateStore(scope.records);

      const lines: string[] = [
        ...problemLines(scope.problems),
        `Spis:   ${dir}`,
        `Klient: ${scope.clientDir ?? "— (subjekty nie sú na klientskej úrovni)"}`,
        "",
      ];

      if (subjekty.length === 0) {
        lines.push("Žiadne subjekty — AML evidencia je prázdna.");
        return ok(lines.join("\n"));
      }

      for (const raw of subjekty) {
        const r = maskRecord(raw);
        lines.push(`${r.id}  ${(r.role ?? "—").padEnd(12)} ${(r.person_type ?? "—").padEnd(4)} ${r.title}`);
        for (const key of ["birth_number", "birth_date", "id_document_number", "residence", "registry_id", "pep"]) {
          const v = (r as unknown as Record<string, unknown>)[key];
          if (typeof v === "string" && v !== "") {
            lines.push(`        ${fieldLabel(key, r.jurisdiction).padEnd(18)} ${v}`);
          }
        }
        const mine = preverenia.filter((p) => p.subject_ref === raw.id);
        // Preverenie sa vyžaduje pri klientovi, nie pri protistrane.
        if (mine.length === 0 && raw.role === "client") {
          lines.push("        preverenie        — žiadne (§ 8 vyžaduje preverenie klienta)");
        }
        for (const p of mine) {
          lines.push(
            `        preverenie        ${p.id}  ${p.check_date ?? "?"}  režim ${p.mode ?? "?"}` +
              `  riziko ${p.risk ?? "?"}  platí do ${p.valid_until ?? "?"}`,
          );
        }
        lines.push("");
      }

      const relevantne = findings.filter((f) => f.code.startsWith("AML_") || f.code.startsWith("SENSITIVE"));
      if (relevantne.length > 0) {
        lines.push("Nálezy:");
        for (const f of relevantne) {
          lines.push(`  ${f.severity.toUpperCase()} ${f.code} ${f.recordId}: ${f.message}`);
        }
      } else {
        lines.push("AML evidencia bez nálezov.");
      }
      return ok(lines.join("\n"));
    }

    case "write": {
      const file = flagValue(rest, "--file");
      const reason = flagValue(rest, "--reason");
      const approveAs = flagValue(rest, "--approve-as");

      if (!file || !reason) {
        return { code: 2, out: `Príkaz write vyžaduje --file a --reason.\n\n${USAGE}` };
      }
      if (!existsSync(file)) return { code: 2, out: `Súbor návrhu neexistuje: ${file}` };

      let after: OkfRecord;
      try {
        after = parseRecord(readFileSync(file, "utf8"));
      } catch (e) {
        return { code: 2, out: `Návrh sa nedá prečítať: ${e instanceof Error ? e.message : String(e)}` };
      }

      const store = readStore(dir);
      const before = store.records.find((r) => r.id === after.id);

      let diff: WriteDiff;
      try {
        diff = planWrite(before, after, reason);
      } catch (e) {
        return { code: 1, out: `ODMIETNUTÉ: ${e instanceof Error ? e.message : String(e)}` };
      }

      const out: string[] = [
        `${nadpisZapisu(diff.kind)} ${diff.id} (${after.type}, ${diff.layer})`,
        `Dôvod: ${diff.reason}`,
        "",
        ...diff.lines,
        "",
      ];

      if (!apply) {
        out.push(
          diff.requiresApproval
            ? `dry-run: zápis do vrstvy ${diff.layer} vyžaduje schválenie človekom. ` +
              `Zapíš s --apply --approve-as "<meno>".`
            : "dry-run: nič sa nezapísalo. Zapíš s --apply.",
        );
        return ok(out.join("\n"));
      }

      if (diff.requiresApproval && approveAs === undefined) {
        out.push(
          `ODMIETNUTÉ: zápis do vrstvy ${diff.layer} vyžaduje --approve-as "<meno advokáta>". ` +
            `Meno zadáva človek, agent si ho nekonštruuje sám.`,
        );
        return { code: 1, out: out.join("\n") };
      }

      const approval: Approval | undefined =
        approveAs === undefined ? undefined : { by: approveAs, at: new Date().toISOString() };

      // Audit riadok sa pridáva AŽ po tom, čo návrh prešiel bránami. Keby sa
      // pridal skôr, história by rástla pri každom zápise a brána atomicity
      // pravdy by bola splnená vždy — teda by neplatila.
      let zapis = diff;
      if (approval !== undefined) {
        const auditovany: OkfRecord = {
          ...after,
          timeline: [
            ...after.timeline,
            { date: approval.at.slice(0, 10), text: `schválil ${approval.by} — ${diff.reason}` },
          ],
        };
        zapis = planWrite(before, auditovany, reason);
      }

      try {
        applyRecordWrite(dir, zapis, approval);
      } catch (e) {
        return { code: 1, out: `ODMIETNUTÉ: ${e instanceof Error ? e.message : String(e)}` };
      }

      out.push(`Zapísané: ${diff.id}${approval ? ` (schválil ${approval.by})` : ""}.`);
      return ok(out.join("\n"));
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
