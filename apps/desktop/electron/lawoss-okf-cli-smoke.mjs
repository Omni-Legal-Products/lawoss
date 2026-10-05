import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * LAWOSS: prostredie, v ktorom je v PATH iba `nodeDirectory`. Kľúč PATH sa na
 * Windows píše rôzne (`Path`), preto sa odstránia všetky jeho varianty.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} nodeDirectory
 */
export function onlyNodeOnPath(env, nodeDirectory) {
  const rest = Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== "PATH"));
  return { ...rest, PATH: nodeDirectory, NODE_OPTIONS: "", ELECTRON_RUN_AS_NODE: "" };
}

/**
 * LAWOSS: overí, že ESM bundle OKF (`okf.js`, `okf-memory.js`) založia klienta,
 * spis aj pamäť spisu s Node, ktorý je jediný v PATH.
 *
 * Skill ich do workspace kopíruje ako `resources/okf.js` bez package.json, takže
 * Node musí ESM rozpoznať podľa syntaxe (od 20.19 a 22.7; 21.x ani 22.0–22.6 nie).
 * Kópia leží v dočasnom priečinku s medzerou a spis v ceste s diakritikou, ako
 * v kancelárii; na Windows sa tak overí aj odovzdanie argumentov a rozpoznanie
 * hlavného modulu. Nestačí kód 0: bundle, ktorý sa nespozná ako hlavný modul,
 * skončí ticho bez zápisu, preto sa kontrolujú aj vytvorené súbory.
 *
 * @param {{ nodeDirectory: string, okfCli?: string, memoryCli?: string, env?: NodeJS.ProcessEnv }} options
 */
export async function checkOkfCliWithNode({
  nodeDirectory,
  okfCli = path.join(REPO_ROOT, "lawoss", "okf", "bundle", "okf.js"),
  memoryCli = path.join(REPO_ROOT, "lawoss", "okf-pamat", "bundle", "okf-memory.js"),
  env = process.env,
}) {
  // Natívny realpath rozvinie na Windows aj krátke názvy 8.3 (RUNNER~1).
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), "lawoss okf cli-")));
  try {
    const okf = path.join(temporary, "okf.js");
    const memory = path.join(temporary, "okf-memory.js");
    await copyFile(okfCli, okf);
    await copyFile(memoryCli, memory);
    const childEnv = onlyNodeOnPath(env, nodeDirectory);
    /** @param {string} label @param {string[]} args */
    const run = (label, args) => {
      const result = spawnSync("node", args, { cwd: temporary, env: childEnv, encoding: "utf8", timeout: 30_000, windowsHide: true });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, `${label} skončil s kódom ${result.status}\n${result.stdout}\n${result.stderr}`);
      return result.stdout;
    };

    const client = path.join(temporary, "AK", "N", "Novák");
    const matter = path.join(client, "Spisy", "2026-10 Vec");
    const clientResult = JSON.parse(run("okf apply klient", [okf, "apply", "klient", client, "--title", "Novák", "--sk", "--json"]));
    assert.ok(clientResult.created?.includes("client.md"), `okf apply klient nezaložil client.md: ${JSON.stringify(clientResult)}`);
    const matterResult = JSON.parse(run("okf apply spis", [okf, "apply", "spis", matter, "--title", "Vec", "--sk", "--json"]));
    assert.ok(matterResult.created?.includes("matter.md"), `okf apply spis nezaložil matter.md: ${JSON.stringify(matterResult)}`);
    run("okf-memory init", [memory, "init", matter, "--apply"]);
    assert.ok(existsSync(path.join(matter, "BRAIN.md")), "okf-memory init nezaložil BRAIN.md");
    assert.ok(existsSync(path.join(matter, "memory")), "okf-memory init nezaložil memory/");
    assert.match(run("okf-memory validate", [memory, "validate", matter]), /^OK/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
