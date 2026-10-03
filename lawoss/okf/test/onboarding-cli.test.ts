import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runOnboarding } from "../src/onboarding/cli.ts";
import { inspectOnboardingRoot } from "../src/onboarding/classify.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "okf-onboarding-cli-"))); roots.push(base);
  const client = join(base, "client"), journal = join(base, "journal"), plan = join(base, "plan.json");
  await mkdir(client); await mkdir(journal); await writeFile(join(client, "original.txt"), "Original bytes\n");
  return { client, journal, plan };
}
async function run(args: string[]) {
  const output: string[] = [];
  return { code: await runOnboarding(args, line => output.push(line)), output: output.join("\n") };
}
const planFlags = ["--title", "Synthetic client", "--client-type", "po", "--language", "sk", "--jurisdiction", "sk", "--date", "2026-10-03", "--confirm-client"];

test("CLI preview creates only the external plan; approval applies exactly that plan idempotently", async () => {
  const f = await fixture(), before = await inspectOnboardingRoot(f.client);
  expect((await run(["classify", f.client, "--json"])).code).toBe(0);
  const preview = await run(["plan", f.client, ...planFlags, "--out", f.plan]);
  expect(preview.code).toBe(0);
  expect((await inspectOnboardingRoot(f.client)).digest).toEqual(before.digest);
  expect((await run(["apply", "--plan", f.plan, "--journal", f.journal])).code).toBe(1);
  expect((await inspectOnboardingRoot(f.client)).digest).toEqual(before.digest);
  const applied = await run(["apply", "--plan", f.plan, "--journal", f.journal, "--confirm"]);
  expect(applied.code).toBe(0);
  expect(JSON.parse(applied.output).status).toBe("applied");
  expect(await readFile(join(f.client, "original.txt"), "utf8")).toBe("Original bytes\n");
  const repeated = await run(["apply", "--plan", f.plan, "--journal", f.journal, "--confirm"]);
  expect(repeated.code).toBe(0);
  expect(JSON.parse(repeated.output).status).toBe("already_applied");
});

test("CLI rejects stale plans and writing previews into the client", async () => {
  const f = await fixture();
  expect((await run(["plan", f.client, ...planFlags, "--out", join(f.client, "preview.json")])).code).toBe(1);
  expect((await run(["plan", f.client, ...planFlags, "--out", f.plan])).code).toBe(0);
  await writeFile(join(f.client, "original.txt"), "New original bytes\n");
  const result = await run(["apply", "--plan", f.plan, "--journal", f.journal, "--confirm"]);
  expect(result.code).toBe(1);
  expect(result.output).toContain("changed");
  expect((await inspectOnboardingRoot(f.client)).entries.map(entry => entry.path)).toEqual(["original.txt"]);
});

test("CLI rejects ambiguous and unsupported options", async () => {
  const f = await fixture();
  for (const args of [["plan", f.client, ...planFlags, "--mode", "map"], ["plan", f.client, ...planFlags, "--title", "Duplicate"], ["classify", f.client, "--unknown", "x"]]) expect((await run(args)).code).toBe(1);
});
