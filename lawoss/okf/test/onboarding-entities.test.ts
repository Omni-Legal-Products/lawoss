import { afterEach, expect, test } from "bun:test";
import { lstat, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyOnboarding, parseOnboardingRequest, planOnboarding } from "../src/onboarding/onboarding.ts";

const paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory(prefix: string) { const path = await realpath(await mkdtemp(join(tmpdir(), prefix))); paths.push(path); return path; }
async function options() { return { journalDirectory: await directory("okf-journal-"), externalProfileDirectory: await directory("okf-external-") }; }

test("parses only complete typed public requests", () => {
  expect(() => parseOnboardingRequest({ action: "matter", clientRoot: "/x", parent: "/x", title: "M", date: "2026-10-03", kind: "non_contentious", area: "IP", jurisdiction: "sk" })).not.toThrow();
  expect(() => parseOnboardingRequest({ action: "matter", parent: "/x", title: "M", date: "no", kind: "other" })).toThrow();
  expect(() => parseOnboardingRequest({ action: "existing", root: "/x", mode: "map", memoryPath: "MEMORY.md" })).toThrow();
});

test("plans and applies new office and every client type without overwrite operations", async () => {
  const parent = await directory("okf-parent-");
  const office = await planOnboarding(parseOnboardingRequest({ action: "office", parent, title: "Office", jurisdiction: "sk", language: "sk", lawyerName: "M" }));
  expect(office.mode).toBe("new");
  await applyOnboarding(office, await options());
  expect(await readFile(join(parent, "Office/okf.config"), "utf8")).toContain("jurisdiction: sk");
  for (const clientType of ["fo", "fo-podnikatel", "po", "iny"] as const) {
    const preview = await planOnboarding(parseOnboardingRequest({ action: "client", parent, name: clientType, title: clientType, clientType, jurisdiction: "sk", date: "2026-10-03", language: "sk" }));
    if (preview.mode !== "new") throw new Error("Expected new client plan.");
    expect(preview.plan.operations.every(operation => operation.kind === "directory" || typeof operation.content === "string")).toBe(true);
    await applyOnboarding(preview, await options());
    expect(await readFile(join(parent, clientType, "client.md"), "utf8")).toContain(`client_type: ${clientType}`);
  }
});

test("subject and both matter kinds carry additive identity fields", async () => {
  const client = await directory("okf-client-");
  await writeFile(join(client, "client.md"), "---\ntype: client\n---\n");
  const subject = await planOnboarding(parseOnboardingRequest({ action: "subject", clientRoot: client, name: "Personal", title: "Personal" }));
  await applyOnboarding(subject, await options());
  for (const kind of ["contentious", "non_contentious"] as const) {
    const preview = await planOnboarding(parseOnboardingRequest({ action: "matter", clientRoot: client, parent: client, title: kind, date: "2026-10-03", kind, area: "IP", subject: "Personal", jurisdiction: "sk" }));
    const result = await applyOnboarding(preview, await options());
    if (preview.mode !== "new") throw new Error("Expected matter plan.");
    const card = await readFile(join(preview.target, "matter.md"), "utf8");
    expect(card).toContain(`kind: ${kind}`);
    expect(card).toContain(`matter_kind: ${kind === "contentious" ? "dispute" : "other"}`);
    expect(card).toContain('area: "IP"');
    expect(card).toContain('subject: "Personal"');
    expect(result.clientRoot).toBe(client);
    expect(result.matterRoot).toBe(preview.target);
  }
});

test("a matter under an existing subject stays inside the client; a sibling folder is refused", async () => {
  const client = await directory("okf-client-subject-");
  await writeFile(join(client, "client.md"), "---\ntype: client\n---\n");
  await applyOnboarding(await planOnboarding(parseOnboardingRequest({ action: "subject", clientRoot: client, name: "Novak Jan", title: "Novák Jan" })), await options());
  const subjectRoot = join(client, "Novak Jan");
  const preview = await planOnboarding(parseOnboardingRequest({ action: "matter", clientRoot: client, parent: subjectRoot, title: "Zmluva", date: "2026-10-05", kind: "non_contentious", area: "IP", jurisdiction: "cz" }));
  if (preview.mode !== "new") throw new Error("Expected matter plan.");
  expect(preview.target).toBe(join(subjectRoot, "Spisy", "2026-10 Zmluva"));
  await applyOnboarding(preview, await options());
  expect(await readFile(join(preview.target, "matter.md"), "utf8")).toContain("kind: non_contentious");
  const sibling = await directory("okf-client-sibling-");
  await expect(planOnboarding(parseOnboardingRequest({ action: "matter", clientRoot: client, parent: sibling, title: "Mimo", date: "2026-10-05", kind: "contentious", area: "IP", jurisdiction: "cz" }))).rejects.toThrow(/within/);
});

test("map is read-only and only accepts a selected inspected memory source", async () => {
  const root = await directory("okf-map-");
  const externalParent = await directory("okf-map-external-");
  await writeFile(join(root, "MEMORY.md"), "historic client-record-1");
  const preview = await planOnboarding(parseOnboardingRequest({ action: "existing", root, mode: "map", memoryPath: "MEMORY.md", identityAnchor: "client-record-1" }));
  const before = await readFile(join(root, "MEMORY.md"), "utf8");
  const externalProfileDirectory = join(externalParent, "new", "app-files", ".opencode");
  const result = await applyOnboarding(preview, { journalDirectory: await directory("okf-journal-"), externalProfileDirectory });
  expect(result.appFiles).toBe("outside");
  expect(await readFile(join(root, "MEMORY.md"), "utf8")).toBe(before);
  expect(await readFile(join(externalProfileDirectory, "memory-profile.json"), "utf8")).toContain("existing_memory");
  await expect(applyOnboarding(preview, { journalDirectory: await directory("okf-journal-"), externalProfileDirectory: join(root, ".opencode", "memory") })).rejects.toThrow("outside the mapped client directory");
  await expect(lstat(join(root, ".opencode"))).rejects.toThrow();
  await expect(applyOnboarding(preview, { journalDirectory: await directory("okf-journal-"), externalProfileDirectory: join(root, "..cache") })).rejects.toThrow("outside the mapped client directory");
  await expect(lstat(join(root, "..cache"))).rejects.toThrow();
  await expect(planOnboarding(parseOnboardingRequest({ action: "existing", root, mode: "map", memoryPath: "other.md", identityAnchor: "x" }))).rejects.toThrow("selected inspected");
});

test("trial clone preserves binary bytes, records provenance, and rejects stale source", async () => {
  const source = await directory("okf-source-");
  const destination = await directory("okf-clones-");
  const bytes = Buffer.from([0, 255, 12, 44, 0]);
  await writeFile(join(source, "original.bin"), bytes);
  const trialRequest = { action: "existing", root: source, mode: "trial_clone", cloneParent: destination, title: "Trial", clientType: "po", language: "sk", jurisdiction: "sk", date: "2026-10-03", confirmUnknownClient: true } as const;
  const preview = await planOnboarding(parseOnboardingRequest(trialRequest));
  await applyOnboarding(preview, await options());
  if (preview.mode !== "trial_clone") throw new Error("Expected trial clone.");
  expect(await readFile(join(preview.target, "original.bin"))).toEqual(bytes);
  expect(JSON.parse(await readFile(join(preview.target, ".lawoss-trial.json"), "utf8"))).toMatchObject({ trial: true, sourceDigest: preview.sourceDigest });
  const stale = await planOnboarding(parseOnboardingRequest(trialRequest));
  await writeFile(join(source, "changed.txt"), "changed");
  await expect(applyOnboarding(stale, await options())).rejects.toThrow("changed since planning");
  expect(await readFile(join(source, "original.bin"))).toEqual(bytes);
});

test("company names with inner dots are safe folder names; a trailing dot is dropped from the folder only", async () => {
  const parent = await directory("okf-dots-");
  const preview = await planOnboarding(parseOnboardingRequest({ action: "client", parent, name: "Novák s. r. o.", title: "Novák s. r. o.", clientType: "po", jurisdiction: "sk", date: "2026-10-04", language: "sk" }));
  if (preview.mode !== "new") throw new Error("Expected new client plan.");
  expect(preview.target).toBe(join(parent, "Novák s. r. o"));
  await applyOnboarding(preview, await options());
  expect(await readFile(join(parent, "Novák s. r. o", "client.md"), "utf8")).toContain("Novák s. r. o.");
  const matter = await planOnboarding(parseOnboardingRequest({ action: "matter", clientRoot: preview.target, parent: preview.target, title: "Zmluva s ABC a. s.", date: "2026-10-04", kind: "non_contentious", area: "Obch. právo", jurisdiction: "sk" }));
  if (matter.mode !== "new") throw new Error("Expected matter plan.");
  // Vec v `Spisy/` ako v šablóne klienta; oblasť je údaj v karte, nie priečinok (D1 2026-10-04).
  expect(matter.target).toBe(join(preview.target, "Spisy", "2026-10 Zmluva s ABC a. s"));
  await applyOnboarding(matter, await options());
  const card = await readFile(join(matter.target, "matter.md"), "utf8");
  expect(card).toContain('area: "Obch. právo"');
  expect(card).toContain('klient: "Novák s. r. o."');
  expect(card).toContain("](<../../client.md>)");
});

test("unsafe folder names are still rejected", async () => {
  const parent = await directory("okf-unsafe-");
  const request = (name: string) => parseOnboardingRequest({ action: "client", parent, name, title: "T", clientType: "po", jurisdiction: "sk", date: "2026-10-04", language: "sk" });
  for (const name of [" ", ".", "..", "...", ". .", ".skryty", "a/b", "a\\b", "C:x", "a\0b", "a<b", "a>b", "a\"b", "a|b", "a?b", "a*b", "x".repeat(121)]) {
    await expect(planOnboarding(request(name))).rejects.toThrow("A safe non-empty folder name is required.");
  }
});
