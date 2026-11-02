// Bundle a checksum-pinned Node LTS for workspace tools. Node 22 preserves the
// macOS 12 support of Electron 43; Node 24 requires macOS 13.5 or later.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(path.join(desktopRoot, "build/node-runtime.json"), "utf8"));
const triples = {
  "aarch64-apple-darwin": "darwin-arm64", "x86_64-apple-darwin": "darwin-x64",
  "aarch64-unknown-linux-gnu": "linux-arm64", "x86_64-unknown-linux-gnu": "linux-x64",
  "aarch64-pc-windows-msvc": "win-arm64", "x86_64-pc-windows-msvc": "win-x64",
};
const requestedTarget = process.env.CARGO_CFG_TARGET_TRIPLE ?? process.env.TARGET;
const target = requestedTarget ? triples[requestedTarget] : `${process.platform === "win32" ? "win" : process.platform}-${process.arch}`;
if (!target || !config.sha256[target]) throw new Error(`Unsupported Node runtime target: ${requestedTarget ?? target}`);
const isWindows = target.startsWith("win-");
const name = `node-v${config.version}-${target}`;
const archive = `${name}.${isWindows ? "zip" : "tar.gz"}`;
const output = path.join(desktopRoot, "resources/node");
const executable = isWindows ? "node.exe" : "node";
// 🟡 LAWOSS: npm z toho istého archívu, aby balíky LAWOSS Marketplace (`node scripts/run.mjs`)
// pri prvom spustení nainštalovali závislosti aj bez Node.js v systéme.
const npmLauncher = isWindows ? "npm.cmd" : "npm";
const npmCli = isWindows ? "node_modules/npm/bin/npm-cli.js" : "lib/node_modules/npm/bin/npm-cli.js";
const expectedMetadata = JSON.stringify({ version: config.version, target, archiveSha256: config.sha256[target], npm: true });
try {
  const existing = JSON.parse(await readFile(path.join(output, "runtime.json"), "utf8"));
  const binaryHash = createHash("sha256").update(await readFile(path.join(output, executable))).digest("hex");
  await readFile(path.join(output, npmLauncher));
  await readFile(path.join(output, npmCli));
  if (JSON.stringify(existing.source) === expectedMetadata && existing.binarySha256 === binaryHash) {
    console.log(`[node-runtime] ${config.version} ${target} already verified`);
    process.exit(0);
  }
} catch { /* First build or incomplete cached runtime: download and verify below. */ }
const temporary = await mkdtemp(path.join(tmpdir(), "legalwork-node-runtime-"));
try {
  const response = await fetch(`https://nodejs.org/dist/v${config.version}/${archive}`);
  if (!response.ok) throw new Error(`Node runtime download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== config.sha256[target]) throw new Error(`Node runtime checksum mismatch for ${archive}`);
  await mkdir(output, { recursive: true });
  await rm(path.join(output, isWindows ? "node_modules" : "lib"), { recursive: true, force: true });
  if (isWindows) {
    const npmPrefix = `${name}/node_modules/npm/`;
    const files = unzipSync(bytes, { filter: ({ name: entry }) => entry === `${name}/node.exe` || entry === `${name}/LICENSE`
      || entry === `${name}/npm.cmd` || (entry.startsWith(npmPrefix) && !entry.endsWith("/")) });
    for (const file of ["node.exe", "LICENSE", "npm.cmd", "node_modules/npm/bin/npm-cli.js"]) {
      if (!files[`${name}/${file}`]) throw new Error(`Node archive is missing ${file}`);
    }
    for (const [entry, content] of Object.entries(files)) {
      const destination = path.join(output, entry.slice(name.length + 1));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, content);
    }
  } else {
    const archivePath = path.join(temporary, archive);
    await writeFile(archivePath, bytes);
    const result = spawnSync("tar", ["-xzf", archivePath, "-C", temporary, `${name}/bin/node`, `${name}/LICENSE`, `${name}/lib/node_modules/npm`], { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Node runtime extraction failed: ${result.status}`);
    await copyFile(path.join(temporary, name, "bin/node"), path.join(output, "node"));
    await copyFile(path.join(temporary, name, "LICENSE"), path.join(output, "LICENSE"));
    await chmod(path.join(output, "node"), 0o755);
    await cp(path.join(temporary, name, "lib/node_modules/npm"), path.join(output, "lib/node_modules/npm"), { recursive: true });
    // Vlastný spúšťač namiesto symlinku bin/npm: `#!/usr/bin/env node` by hľadal systémový Node
    // a symlink by electron-builder nemusel zachovať. Cestu berie z $0 bez `dirname`, aby fungoval
    // aj s PATH, v ktorom je len tento priečinok.
    await writeFile(path.join(output, "npm"), '#!/bin/sh\ncase "$0" in */*) dir="${0%/*}" ;; *) dir=. ;; esac\nexec "$dir/node" "$dir/lib/node_modules/npm/bin/npm-cli.js" "$@"\n');
    await chmod(path.join(output, "npm"), 0o755);
  }
  const binarySha256 = createHash("sha256").update(await readFile(path.join(output, executable))).digest("hex");
  await writeFile(path.join(output, "runtime.json"), JSON.stringify({ source: JSON.parse(expectedMetadata), binarySha256 }, null, 2) + "\n");
  console.log(`[node-runtime] verified and prepared Node ${config.version} for ${target}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
