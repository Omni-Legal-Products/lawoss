import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLED_WORKFLOW_NAMES, ensureBundledWorkflows } from "../bundled-workflows.js";
import { ensureLawossBundledWorkflows, LAWOSS_HIDDEN_BUNDLED_WORKFLOWS } from "./hidden-bundled-workflows.js";

// #255 A2 (MČ 10. 11. 2026): anglické pribalené workflowy sa v LAWOSS neinštalujú; nezmenené staršie kópie zmiznú.

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "lawoss-hidden-workflows-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const installed = async () => (await readdir(root)).sort();

describe("skryté pribalené workflowy", () => {
  test("čistý profil: skryté workflowy sa nenainštalujú, ostatné áno", async () => {
    await ensureLawossBundledWorkflows(root);
    const expected = BUNDLED_WORKFLOW_NAMES.filter(name => !LAWOSS_HIDDEN_BUNDLED_WORKFLOWS.has(name)).sort();
    expect(await installed()).toEqual(expected);
    for (const name of LAWOSS_HIDDEN_BUNDLED_WORKFLOWS) expect(BUNDLED_WORKFLOW_NAMES).toContain(name);
  });

  test("nezmenená kópia zo staršej verzie sa odstráni, aj opakovane bez chyby", async () => {
    await ensureBundledWorkflows(root);
    expect(await installed()).toEqual([...BUNDLED_WORKFLOW_NAMES].sort());
    await ensureLawossBundledWorkflows(root);
    await ensureLawossBundledWorkflows(root);
    for (const name of LAWOSS_HIDDEN_BUNDLED_WORKFLOWS) expect(await installed()).not.toContain(name);
  });

  test("upravenú alebo doplnenú kópiu advokáta ponechá", async () => {
    await ensureBundledWorkflows(root);
    await writeFile(join(root, "workflow-firm-knowledge", "SKILL.md"), "---\nname: workflow-firm-knowledge\ndescription: Vlastná verzia.\n---\n\nVlastný postup.\n");
    await writeFile(join(root, "workflow-assistant-due-diligence", "poznamky.md"), "Doplnené advokátom.\n");
    await ensureLawossBundledWorkflows(root);
    expect(await installed()).toEqual(expect.arrayContaining(["workflow-firm-knowledge", "workflow-assistant-due-diligence"]));
  });
});
