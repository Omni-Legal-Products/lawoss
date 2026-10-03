import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { inspectOnboardingRoot } from "./classify.ts";
import { planClientConversion, type ClientConversionInput } from "./plan.ts";
import { applyOnboardingPlan, parseOnboardingPlan, recoverOnboardingPlan } from "./transaction.ts";

const usage = "okf onboard classify <dir> | plan <dir> --title NAME --client-type po|fo|fo-podnikatel|iny --language sk|cs|en --jurisdiction sk|cz --date YYYY-MM-DD [--confirm-client] [--out FILE] | apply --plan FILE --journal DIR --confirm | recover --plan FILE --journal DIR --action finish|rollback --confirm";
const maxPlanBytes = 4 * 1024 * 1024;
function parse(argv: string[]) {
  const args: string[] = [], flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i]!;
    if (!value.startsWith("--")) { args.push(value); continue; }
    if (flags.has(value)) throw new Error(`Duplicate flag: ${value}`);
    if (["--confirm-client", "--confirm", "--json"].includes(value)) flags.set(value, true);
    else {
      const next = argv[++i];
      if (!next || next.startsWith("--")) throw new Error(`Missing value: ${value}`);
      flags.set(value, next);
    }
  }
  return { args, flags };
}
function required(flags: Map<string, string | true>, name: string): string {
  const value = flags.get(name);
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${name}.`);
  return value;
}
function choice<T extends string>(flags: Map<string, string | true>, name: string, choices: readonly T[]): T {
  const value = required(flags, name), selected = choices.find(choice => choice === value);
  if (selected === undefined) throw new Error(`Invalid ${name}.`);
  return selected;
}
function only(flags: Map<string, string | true>, allowed: string[]) {
  for (const key of flags.keys()) if (!allowed.includes(key)) throw new Error(`Unsupported flag: ${key}`);
}
async function readPlan(path: string): Promise<unknown> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxPlanBytes) throw new Error("Invalid plan file size/type.");
    // A bounded read also handles a file growing after stat.
    const buffer = Buffer.alloc(maxPlanBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const result = await handle.read(buffer, size, buffer.length - size, null);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    if (size > maxPlanBytes) throw new Error("Plan file is too large.");
    return JSON.parse(buffer.subarray(0, size).toString("utf8"));
  } finally { await handle.close(); }
}
async function savePlanOutside(root: string, path: string, content: string): Promise<void> {
  const target = resolve(path), parent = dirname(target);
  const rel = relative(root, target);
  if (!rel || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))) throw new Error("Save the preview outside the client directory.");
  if (await realpath(parent) !== parent || !(await lstat(parent)).isDirectory()) throw new Error("Plan output needs an existing canonical parent directory.");
  const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
}

/** Portable explicit commands; no model, workspace activation or implicit apply. */
export async function runOnboarding(argv: string[], out: (line: string) => void = console.log): Promise<number> {
  try {
    const { args, flags } = parse(argv);
    const command = args[0];
    if (command === "classify") {
      only(flags, ["--json"]);
      if (args.length !== 2) throw new Error(usage);
      const result = await inspectOnboardingRoot(args[1]!);
      out(JSON.stringify(result, null, 2));
      return result.complete && result.level !== "conflict" ? 0 : 1;
    }
    if (command === "plan") {
      only(flags, ["--title", "--client-type", "--language", "--jurisdiction", "--date", "--confirm-client", "--out", "--json"]);
      if (args.length !== 2) throw new Error(usage);
      const input: ClientConversionInput = {
        title: required(flags, "--title"), clientType: choice(flags, "--client-type", ["po", "fo", "fo-podnikatel", "iny"]),
        language: choice(flags, "--language", ["sk", "cs", "en"]), jurisdiction: choice(flags, "--jurisdiction", ["sk", "cz"]),
        date: required(flags, "--date"), confirmUnknownClient: flags.get("--confirm-client") === true,
      };
      const preview = await planClientConversion(args[1]!, input);
      if (flags.has("--out")) await savePlanOutside(preview.plan.root, required(flags, "--out"), JSON.stringify(preview.plan, null, 2) + "\n");
      out(JSON.stringify(preview, null, 2));
      return 0;
    }
    if (command === "apply" || command === "recover") {
      only(flags, command === "apply" ? ["--plan", "--journal", "--confirm", "--json"] : ["--plan", "--journal", "--confirm", "--json", "--action"]);
      if (args.length !== 1 || flags.get("--confirm") !== true) throw new Error("Show the plan to the user, then invoke with --confirm after approval.");
      const plan = parseOnboardingPlan(await readPlan(required(flags, "--plan")));
      const journal = required(flags, "--journal");
      const result = command === "apply" ? await applyOnboardingPlan(plan, journal) : await recoverOnboardingPlan(plan, journal, choice(flags, "--action", ["finish", "rollback"]));
      out(JSON.stringify(result, null, 2));
      return 0;
    }
    throw new Error(usage);
  } catch (error) { out(`okf onboard: ${error instanceof Error ? error.message : String(error)}`); return 1; }
}
