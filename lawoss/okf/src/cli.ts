#!/usr/bin/env bun
/**
 * okf — CLI nad priečinkom klienta. Súbory dnu, súbory von. Žiadny server.
 *
 *   okf detect <dir> [--type klient|spis|projekt] [--json]
 *   okf plan <typ> <dir> --title "…" [--ico X] [--klient X] [--protistrana X]
 *            [--protistrana-ico X] [--oblast X] [--desc X] [--json]
 *   okf apply <typ> <dir> --title "…" [rovnaké flagy]        ← až po potvrdení človekom
 *   okf validate <dir> [--json]                                 exit 1 pri chybe
 *   okf render <dir> [--json]
 *
 * Ľudská brána je ZÁMERNE mimo CLI: `plan` nič nezapíše; `apply` volá ten,
 * kto plán ukázal advokátovi a dostal súhlas.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ENTITY_TYPES, type EntityType, type PlanInput } from "./core.ts";
import { apply, detect, plan, render, validate } from "./fs.ts";

type Flags = Record<string, string | boolean>;

function parseArgs(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else { flags[key] = next; i += 1; }
  }
  return { positional, flags };
}

function str(flags: Flags, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function entityType(value: string | undefined): EntityType {
  if (value && (ENTITY_TYPES as readonly string[]).includes(value)) return value as EntityType;
  throw new Error(`typ musí byť ${ENTITY_TYPES.join(" | ")}; dostal som: ${value ?? "(nič)"}`);
}

function inputFrom(positional: string[], flags: Flags): PlanInput {
  const type = entityType(positional[1]);
  const dir = positional[2];
  if (!dir) throw new Error("chýba <dir>");
  const title = str(flags, "title") ?? dir.split(/[\\/]/).filter(Boolean).pop() ?? "";
  return {
    type, dir, title,
    description: str(flags, "desc"), ico: str(flags, "ico"), klient: str(flags, "klient"),
    protistrana: str(flags, "protistrana"), protistranaIco: str(flags, "protistrana-ico"),
    oblast: str(flags, "oblast"), spzn: str(flags, "spzn"), sud: str(flags, "sud"), date: str(flags, "date"),
  };
}

export function run(argv: string[], out: (line: string) => void = console.log): number {
  const { positional, flags } = parseArgs(argv);
  const json = flags.json === true;
  const cmd = positional[0];
  try {
    switch (cmd) {
      case "detect": {
        const dir = positional[1]; if (!dir) throw new Error("chýba <dir>");
        const hint = str(flags, "type"); const result = detect(dir, hint ? entityType(hint) : undefined);
        if (json) { out(JSON.stringify(result, null, 2)); return 0; }
        if (!result.isDir) { out(`nie je priečinok: ${dir}`); return 1; }
        out(`${dir}`);
        out(`  typ: ${result.type ?? "— (bez OKF karty)"}   AGENTS.md: ${result.hasAgents ? "áno" : "nie"}   CLAUDE.md: ${result.hasClaude ? (result.claudeIsMirror ? "mirror" : "vlastný") : "nie"}`);
        out(`  okf_version: ${result.okfVersion ?? "—"}   markdown súborov: ${result.markdownCount}`);
        out(result.missing.length ? `  chýba: ${result.missing.join(", ")}` : "  chýba: nič");
        return 0;
      }
      case "plan": {
        const p = plan(inputFrom(positional, flags));
        if (json) { out(JSON.stringify({ ...p, entries: p.entries.map(({ content: _c, ...e }) => e) }, null, 2)); return 0; }
        out(`plán pre ${p.type} v ${p.dir} — nič sa nezapísalo`);
        for (const e of p.entries) out(`  ${e.action === "create" ? "+" : "="} ${e.path}${e.action === "skip" ? "   (existuje, bez zmeny)" : ""}`);
        return 0;
      }
      case "apply": {
        const result = apply(plan(inputFrom(positional, flags)));
        if (json) { out(JSON.stringify(result, null, 2)); return 0; }
        for (const f of result.created) out(`+ ${f}`);
        for (const f of result.skipped) out(`= ${f}   (existuje, bez zmeny)`);
        out(`vytvorené: ${result.created.length}, preskočené: ${result.skipped.length}`);
        return 0;
      }
      case "validate": {
        const dir = positional[1]; if (!dir) throw new Error("chýba <dir>");
        const errors = validate(dir);
        if (json) { out(JSON.stringify({ ok: errors.length === 0, errors }, null, 2)); return errors.length ? 1 : 0; }
        for (const e of errors) out(`ERROR: ${e.path} — ${e.message}`);
        out(errors.length ? `${errors.length} chýb` : `OK: ${dir} je konformný (OKF v0.1)`);
        return errors.length ? 1 : 0;
      }
      case "render": {
        const dir = positional[1]; if (!dir) throw new Error("chýba <dir>");
        const result = render(dir);
        if (json) { out(JSON.stringify(result, null, 2)); return 0; }
        for (const f of result.written) out(`~ ${f}   (pregenerované)`);
        for (const f of result.kept) out(`= ${f}`);
        return 0;
      }
      default:
        out("okf detect|plan|apply|validate|render — pozri hlavičku src/cli.ts");
        return cmd ? 2 : 0;
    }
  } catch (error) {
    out(`okf: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

// Spusti iba ako hlavný modul (node aj bun); pri importe z testov nič nespúšťaj.
// `import.meta.main` sa zámerne nepoužíva — bundler ho pre node prepisuje na
// CommonJS `require.main`, ktoré v ESM bundli neexistuje.
const isMain = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) process.exit(run(process.argv.slice(2)));
