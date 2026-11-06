import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { onlyNodeOnPath } from "./lawoss-okf-cli-smoke.mjs";

/**
 * LAWOSS: overí pribalený npm tak, ako ho volá `scripts/run.mjs` balíkov LAWOSS Marketplace:
 * `npm --version` a `npm ci --omit=dev --ignore-scripts` s jediným pribaleným Node v PATH.
 * Projekt bez závislostí nepotrebuje sieť a cache npm leží v dočasnom priečinku, nie v profile.
 *
 * @param {{ nodeDirectory: string }} options
 * @returns {Promise<string>} verzia npm
 */
export async function checkBundledNpm({ nodeDirectory }) {
  const temporary = await mkdtemp(path.join(tmpdir(), "lawoss npm-"));
  try {
    const env = { ...onlyNodeOnPath(process.env, nodeDirectory), npm_config_cache: path.join(temporary, "cache"),
      npm_config_userconfig: path.join(temporary, "npmrc"), npm_config_update_notifier: "false", npm_config_offline: "true" };
    // Ako run.mjs: npm.cmd na Windows. Node od 20.12.2 spustí .cmd len cez shell.
    const npm = (args) => {
      const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
        cwd: temporary, env, encoding: "utf8", timeout: 60_000, shell: process.platform === "win32",
      });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    const version = npm(["--version"]);
    assert.match(version, /^\d+\.\d+\.\d+$/);
    const manifest = { name: "lawoss-npm-smoke", version: "1.0.0", private: true };
    await writeFile(path.join(temporary, "package.json"), JSON.stringify(manifest));
    await writeFile(path.join(temporary, "package-lock.json"), JSON.stringify({
      name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true,
      packages: { "": { name: manifest.name, version: manifest.version } },
    }));
    npm(["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"]);
    assert.equal(JSON.parse(npm(["ls", "--json"])).name, manifest.name);
    return version;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
