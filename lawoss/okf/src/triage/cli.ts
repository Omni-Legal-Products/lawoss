/**
 * okf triage — roztriedenie spisu v skúšobnom klone. Žiadny model, žiadne implicitné zápisy.
 *
 *   okf triage status <klon>
 *   okf triage scan <klon> [--out FILE]
 *   okf triage plan <klon> [--classification FILE] [--keep-in-inbox ID,ID] [--today RRRR-MM-DD]
 *   okf triage apply <klon> --plan FILE --confirm        ← až po potvrdení človekom
 *   okf triage undo <klon> --run RUN_ID --confirm
 *
 * `--trial-journal DIR` overí aj záznam aplikácie o vytvorení klona. Výstup je vždy JSON.
 */
import { join } from "node:path";
import { readJsonFile, triageSubdirectory, writeNewJson } from "./files.ts";
import { applyTriagePlan, latestModelProposal, listTriageRuns, prepareTriage, scanTriage, undoTriage, verifyTrialClone } from "./index.ts";

const usage = "okf triage status <klon> | scan <klon> [--out FILE] | plan <klon> [--classification FILE] [--keep-in-inbox ID,ID] [--today RRRR-MM-DD] | apply <klon> --plan FILE --confirm | undo <klon> --run RUN_ID --confirm  (voliteľne --trial-journal DIR)";

function parse(argv: string[]) {
  const args: string[] = [], flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i]!;
    if (!value.startsWith("--")) { args.push(value); continue; }
    if (flags.has(value)) throw new Error(`Duplicitný prepínač ${value}`);
    if (value === "--confirm" || value === "--json") flags.set(value, true);
    else { const next = argv[++i]; if (!next || next.startsWith("--")) throw new Error(`Chýba hodnota ${value}`); flags.set(value, next); }
  }
  return { args, flags };
}
function only(flags: Map<string, string | true>, allowed: readonly string[]) {
  for (const key of flags.keys()) if (![...allowed, "--json", "--trial-journal"].includes(key)) throw new Error(`Nepodporovaný prepínač ${key}`);
}
const value = (flags: Map<string, string | true>, name: string) => { const item = flags.get(name); return typeof item === "string" ? item : undefined; };

export async function runTriage(argv: string[], out: (line: string) => void = console.log): Promise<number> {
  try {
    const { args, flags } = parse(argv);
    const [command, root] = args;
    if (!command || !root || args.length !== 2) throw new Error(usage);
    const trialJournalDirectory = value(flags, "--trial-journal");
    if (command === "status") {
      only(flags, []);
      const clone = await verifyTrialClone(root, trialJournalDirectory).then(result => ({ trial: true as const, ...result }), (error: unknown) => ({ trial: false as const, reason: error instanceof Error ? error.message : String(error) }));
      out(JSON.stringify({ ...clone, runs: clone.trial ? await listTriageRuns(clone.root) : [] }, null, 2));
      return clone.trial ? 0 : 1;
    }
    if (command === "scan") {
      only(flags, ["--out"]);
      const inventory = await scanTriage(root, { trialJournalDirectory });
      const { proposal } = await latestModelProposal(inventory);
      const output = value(flags, "--out");
      if (output) await writeNewJson(output, inventory);
      out(JSON.stringify({ ...inventory, modelProposal: proposal }, null, 2));
      return 0;
    }
    if (command === "plan") {
      only(flags, ["--classification", "--keep-in-inbox", "--today"]);
      const keep = value(flags, "--keep-in-inbox")?.split(",").map(item => item.trim()).filter(Boolean);
      const today = value(flags, "--today");
      if (today !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("--today musí byť RRRR-MM-DD");
      const { plan } = await prepareTriage(root, { trialJournalDirectory, classificationFile: value(flags, "--classification"), keepInInbox: keep, today });
      const dir = await triageSubdirectory(plan.root, "plans", true);
      const file = join(dir!, `${plan.runId}.json`);
      await writeNewJson(file, plan);
      out(JSON.stringify({ planFile: file, note: "Náhľad; nič sa nepresunulo. Ukáž plán človeku a po jeho súhlase spusti apply --confirm.", plan }, null, 2));
      return 0;
    }
    if (command === "apply") {
      only(flags, ["--plan", "--confirm"]);
      if (flags.get("--confirm") !== true) throw new Error("Najprv ukáž plán človeku a po jeho súhlase spusti apply s --confirm.");
      const file = value(flags, "--plan");
      if (!file) throw new Error("Chýba --plan FILE.");
      const plan = await readJsonFile(file);
      const verified = await verifyTrialClone(root, trialJournalDirectory);
      if (!plan || typeof plan !== "object" || !("root" in plan) || plan.root !== verified.root) throw new Error("Plán patrí inému priečinku.");
      out(JSON.stringify(await applyTriagePlan(plan, { trialJournalDirectory }), null, 2));
      return 0;
    }
    if (command === "undo") {
      only(flags, ["--run", "--confirm"]);
      if (flags.get("--confirm") !== true) throw new Error("Vrátenie potvrď prepínačom --confirm po súhlase človeka.");
      const run = value(flags, "--run");
      if (!run) throw new Error("Chýba --run RUN_ID.");
      out(JSON.stringify(await undoTriage(root, run, { trialJournalDirectory }), null, 2));
      return 0;
    }
    throw new Error(usage);
  } catch (error) { out(`okf triage: ${error instanceof Error ? error.message : String(error)}`); return 1; }
}
