import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { realpath } from "../canonical-path.ts";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { inspectOnboardingRoot } from "./classify.ts";
import { planClientConversion, type ClientConversionInput } from "./plan.ts";
import { applyOnboardingPlan, parseOnboardingPlan, recoverOnboardingPlan } from "./transaction.ts";
import { applyOnboarding, parseOnboardingRequest, planOnboarding, recoverOnboarding, type OnboardingPreview, type OnboardingRequest } from "./onboarding.ts";

const usage = "okf onboard classify <dir> | plan <dir> --title NAME --client-type po|fo|fo-podnikatel|iny --language sk|cs|en --jurisdiction sk|cz --date YYYY-MM-DD [--confirm-client] [--out FILE] | request --request FILE [--out FILE] | create --request FILE --journal DIR --external-profile DIR --confirm | apply --plan FILE --journal DIR --confirm | recover --plan FILE --journal DIR --action finish|rollback --confirm";
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
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
type AggregateEnvelope = { version: 1; request: OnboardingRequest; preview: OnboardingPreview };
function savedPreview(value: unknown, request: OnboardingRequest): OnboardingPreview {
  if (!object(value) || typeof value.action !== "string" || typeof value.mode !== "string" || value.action !== request.action) throw new Error("Invalid aggregate onboarding preview.");
  if (value.mode === "new") {
    if (value.appFiles !== "inside" || typeof value.target !== "string") throw new Error("Invalid aggregate create preview.");
    const plan = parseOnboardingPlan(value.plan);
    if (value.action === "existing" && (request.action !== "existing" || request.mode !== "convert")) throw new Error("Aggregate preview action does not match request.");
    return { action: value.action as "office" | "practice" | "client" | "subject" | "matter" | "existing", mode: "new", appFiles: "inside", target: value.target, ...(typeof value.clientRoot === "string" ? { clientRoot: value.clientRoot } : {}), plan };
  }
  if (value.mode === "trial_clone") {
    if (request.action !== "existing" || request.mode !== "trial_clone" || value.appFiles !== "inside" || typeof value.source !== "string" || typeof value.target !== "string" || typeof value.sourceDigest !== "string" || value.trial !== true) throw new Error("Invalid aggregate trial preview.");
    const conversionPlan = value.conversionPlan === undefined ? undefined : parseOnboardingPlan(value.conversionPlan);
    return { action: "existing", mode: "trial_clone", appFiles: "inside", source: value.source, target: value.target, sourceDigest: value.sourceDigest, trial: true, ...(conversionPlan ? { conversionPlan } : {}) };
  }
  if (value.mode === "map") {
    if (request.action !== "existing" || request.mode !== "map" || value.appFiles !== "outside" || typeof value.root !== "string" || typeof value.sourceDigest !== "string" || !object(value.externalProfile)) throw new Error("Invalid aggregate map preview.");
    return value as OnboardingPreview;
  }
  throw new Error("Invalid aggregate onboarding preview.");
}
async function aggregateEnvelope(value: unknown): Promise<AggregateEnvelope> {
  if (!object(value) || value.version !== 1 || !("request" in value) || !("preview" in value)) throw new Error("Invalid aggregate onboarding preview.");
  const request = parseOnboardingRequest(value.request);
  const preview = savedPreview(value.preview, request);
  return { version: 1, request, preview };
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
    if (command === "request" || command === "create") {
      only(flags, command === "request" ? ["--request", "--out", "--json"] : ["--request", "--journal", "--external-profile", "--confirm", "--json"]);
      if (args.length !== 1) throw new Error(usage);
      const request = parseOnboardingRequest(await readPlan(required(flags, "--request")));
      const preview = await planOnboarding(request);
      if (command === "request") {
        const envelope = { version: 1 as const, request, preview };
        if (flags.has("--out")) {
          const root = preview.mode === "map" ? preview.root : preview.mode === "trial_clone" ? preview.source : preview.plan.root;
          await savePlanOutside(root, required(flags, "--out"), JSON.stringify(envelope, null, 2) + "\n");
        }
        out(JSON.stringify(envelope, null, 2)); return 0;
      }
      if (flags.get("--confirm") !== true) throw new Error("Show the plan to the user, then invoke with --confirm after approval.");
      const result = await applyOnboarding(preview, { journalDirectory: required(flags, "--journal"), externalProfileDirectory: required(flags, "--external-profile") });
      out(JSON.stringify(result, null, 2)); return 0;
    }
    if (command === "apply" || command === "recover") {
      only(flags, command === "apply" ? ["--plan", "--journal", "--external-profile", "--confirm", "--json"] : ["--plan", "--journal", "--external-profile", "--confirm", "--json", "--action"]);
      if (args.length !== 1 || flags.get("--confirm") !== true) throw new Error("Show the plan to the user, then invoke with --confirm after approval.");
      const raw = await readPlan(required(flags, "--plan"));
      const journal = required(flags, "--journal");
      if (object(raw) && "request" in raw && "preview" in raw) {
        const envelope = await aggregateEnvelope(raw);
        const options = { journalDirectory: journal, externalProfileDirectory: required(flags, "--external-profile") };
        const result = command === "apply" ? await applyOnboarding(envelope.preview, options) : await recoverOnboarding(envelope.preview, options, choice(flags, "--action", ["finish", "rollback"]));
        out(JSON.stringify(result, null, 2)); return 0;
      }
      const plan = parseOnboardingPlan(raw);
      const result = command === "apply" ? await applyOnboardingPlan(plan, journal) : await recoverOnboardingPlan(plan, journal, choice(flags, "--action", ["finish", "rollback"]));
      out(JSON.stringify(result, null, 2));
      return 0;
    }
    throw new Error(usage);
  } catch (error) { out(`okf onboard: ${error instanceof Error ? error.message : String(error)}`); return 1; }
}
