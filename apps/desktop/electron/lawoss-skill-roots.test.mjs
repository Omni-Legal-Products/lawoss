import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { withoutClaudeGlobalSkills } from "./lawoss-skill-roots.mjs";

// N-1 (#255): desktop zoznam skillov čítal globálne skilly Claude z ~/.claude/skills, aj cez prechod
// nadradených priečinkov klienta bez gitu.

const home = path.resolve("/Users/advokat");

test("vynechá ~/.claude/skills, ~/.agents/skills a ~/.agent/skills, ostatné priečinky skillov a ich poradie ponechá", () => {
  const roots = [
    path.join(home, "Klienti", "Horak", ".opencode", "skills"),
    path.join(home, "Klienti", "Horak", ".claude", "skills"),
    path.join(home, "Klienti", "Horak", ".agents", "skills"),
    path.join(home, ".claude", "skills"),
    path.join(home, ".config", "opencode", "skills"),
    path.join(home, ".agents", "skills"),
    path.join(home, ".agent", "skills"),
  ];
  // Rozhodnutie MČ 10. 11. 2026: globálne skilly iných agentov sa nečítajú; priečinky vnútri klienta áno.
  assert.deepEqual(withoutClaudeGlobalSkills(roots, [home]), [
    path.join(home, "Klienti", "Horak", ".opencode", "skills"),
    path.join(home, "Klienti", "Horak", ".claude", "skills"),
    path.join(home, "Klienti", "Horak", ".agents", "skills"),
    path.join(home, ".config", "opencode", "skills"),
  ]);
});

test("izolovaný HOME: vynechá ~/.claude/skills izolovaného aj skutočného domova", () => {
  const isolated = path.resolve("/tmp/lawoss-test-home");
  const roots = [path.join(home, ".claude", "skills"), path.join(isolated, ".claude", "skills"), path.join(isolated, ".config", "opencode", "skills")];
  assert.deepEqual(withoutClaudeGlobalSkills(roots, [isolated, home]), [path.join(isolated, ".config", "opencode", "skills")]);
  // Predvolene sa berie HOME aj domov z userInfo().
  assert.deepEqual(withoutClaudeGlobalSkills([path.join(os.userInfo().homedir, ".claude", "skills")]), []);
});

test("main.mjs filtruje projektové aj globálne korene skillov", async () => {
  const main = await readFile(fileURLToPath(new URL("./main.mjs", import.meta.url)), "utf8");
  const project = main.slice(main.indexOf("async function collectProjectSkillRoots"), main.indexOf("async function collectGlobalSkillRoots"));
  const global = main.slice(main.indexOf("async function collectGlobalSkillRoots"), main.indexOf("async function collectSkillRoots"));
  assert.match(project, /return withoutClaudeGlobalSkills\(roots\);\n\}/);
  assert.match(global, /return withoutClaudeGlobalSkills\(roots\);\n\}/);
});
