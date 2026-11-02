import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { bundledNpmVersion, installNpmFromDirectory, installNpmFromZip, npmShim, npmZipEntry } from "./lawoss-node-npm.mjs";

async function withTemporary(run) {
  const root = await mkdtemp(path.join(tmpdir(), "lawoss-node-npm-"));
  try { return await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

async function fakeNpm(root) {
  const source = path.join(root, "source");
  await mkdir(path.join(source, "bin"), { recursive: true });
  await mkdir(path.join(source, "node_modules", ".bin"), { recursive: true });
  await mkdir(path.join(source, "node_modules", "semver"), { recursive: true });
  await writeFile(path.join(source, "package.json"), JSON.stringify({ name: "npm", version: "10.9.4" }));
  await writeFile(path.join(source, "bin", "npm-cli.js"), "require('../lib/cli.js')\n");
  await writeFile(path.join(source, "node_modules", "semver", "index.js"), "module.exports = {}\n");
  await symlink("../semver/index.js", path.join(source, "node_modules", ".bin", "semver"));
  await symlink("bin/npm-cli.js", path.join(source, "linked-cli.js"));
  return source;
}

describe("LAWOSS npm beside the bundled Node runtime", () => {
  it("writes launchers that need no other Node or dirname on PATH", () => {
    const posix = npmShim(false);
    assert.equal(posix.name, "npm");
    assert.match(posix.content, /^#!\/bin\/sh\n/);
    assert.ok(posix.content.includes('npm_config_update_notifier=false exec "${0%/*}/node" "${0%/*}/lib/npm/bin/npm-cli.js" "$@"'));
    assert.ok(!posix.content.includes("dirname") && !posix.content.includes("env node"));
    const windows = npmShim(true);
    assert.equal(windows.name, "npm.cmd");
    assert.equal(windows.content, '@ECHO off\r\nSETLOCAL\r\nSET npm_config_update_notifier=false\r\n"%~dp0node.exe" "%~dp0lib\\npm\\bin\\npm-cli.js" %*\r\n');
  });

  it("selects only npm files from the Windows archive", () => {
    const archive = "node-v22.23.2-win-x64";
    assert.equal(npmZipEntry(archive, `${archive}/node_modules/npm/bin/npm-cli.js`), true);
    assert.equal(npmZipEntry(archive, `${archive}/node_modules/npm/`), false);
    assert.equal(npmZipEntry(archive, `${archive}/node_modules/npm/node_modules/.bin/semver`), false);
    assert.equal(npmZipEntry(archive, `${archive}/node_modules/corepack/package.json`), false);
    assert.equal(npmZipEntry(archive, `${archive}/node.exe`), false);
  });

  it("copies regular npm files from the Unix archive and skips links", () => withTemporary(async (root) => {
    const source = await fakeNpm(root);
    const output = path.join(root, "node");
    await mkdir(output);
    assert.deepEqual(await installNpmFromDirectory(source, output), { version: "10.9.4" });
    const npm = path.join(output, "lib", "npm");
    assert.equal(await readFile(path.join(npm, "bin", "npm-cli.js"), "utf8"), "require('../lib/cli.js')\n");
    assert.ok((await lstat(path.join(npm, "node_modules", "semver", "index.js"))).isFile());
    await assert.rejects(lstat(path.join(npm, "node_modules", ".bin")));
    await assert.rejects(lstat(path.join(npm, "linked-cli.js")));
    assert.equal((await stat(path.join(output, "npm"))).mode & 0o111, 0o111);
    assert.equal(await bundledNpmVersion(output, false), "10.9.4");
    assert.equal(await bundledNpmVersion(output, true), null, "Windows needs npm.cmd");
  }));

  it("replaces an older npm tree instead of merging into it", () => withTemporary(async (root) => {
    const source = await fakeNpm(root);
    const output = path.join(root, "node");
    await mkdir(path.join(output, "lib", "npm", "stale"), { recursive: true });
    await writeFile(path.join(output, "lib", "npm", "stale", "old.js"), "");
    await installNpmFromDirectory(source, output);
    await assert.rejects(lstat(path.join(output, "lib", "npm", "stale")));
  }));

  it("installs npm from Windows zip entries and refuses unsafe paths", () => withTemporary(async (root) => {
    const archive = "node-v22.23.2-win-x64";
    const bytes = (text) => new TextEncoder().encode(text);
    const files = {
      [`${archive}/node.exe`]: bytes("exe"),
      [`${archive}/node_modules/npm/package.json`]: bytes(JSON.stringify({ version: "10.9.4" })),
      [`${archive}/node_modules/npm/bin/npm-cli.js`]: bytes("cli"),
    };
    const output = path.join(root, "node");
    await mkdir(output);
    assert.deepEqual(await installNpmFromZip(files, archive, output), { version: "10.9.4" });
    assert.equal(await readFile(path.join(output, "npm.cmd"), "utf8"), npmShim(true).content);
    assert.equal(await bundledNpmVersion(output, true), "10.9.4");
    await assert.rejects(installNpmFromZip({ ...files, [`${archive}/node_modules/npm/../../evil.js`]: bytes("x") }, archive, output), /Unsafe npm archive entry/);
  }));

  it("reports a missing or broken npm as absent", () => withTemporary(async (root) => {
    assert.equal(await bundledNpmVersion(root, false), null);
    await mkdir(path.join(root, "lib", "npm", "bin"), { recursive: true });
    await writeFile(path.join(root, "npm"), npmShim(false).content);
    await writeFile(path.join(root, "lib", "npm", "bin", "npm-cli.js"), "");
    await writeFile(path.join(root, "lib", "npm", "package.json"), "{");
    assert.equal(await bundledNpmVersion(root, false), null);
    await writeFile(path.join(root, "lib", "npm", "package.json"), JSON.stringify({ version: "latest" }));
    assert.equal(await bundledNpmVersion(root, false), null);
    await writeFile(path.join(root, "lib", "npm", "package.json"), JSON.stringify({ version: "10.9.8" }));
    assert.equal(await bundledNpmVersion(root, false), "10.9.8");
    await writeFile(path.join(root, "npm"), "#!/bin/sh\nexec node \"$@\"\n");
    assert.equal(await bundledNpmVersion(root, false), null, "an outdated launcher is rebuilt");
  }));

  it("runs the POSIX launcher through the sibling node only", { skip: process.platform === "win32" }, () => withTemporary(async (root) => {
    const source = await fakeNpm(root);
    const output = path.join(root, "node dir");
    await mkdir(output);
    await installNpmFromDirectory(source, output);
    await writeFile(path.join(output, "node"), '#!/bin/sh\nprintf "%s|" "$npm_config_update_notifier" "$@"\n');
    await chmod(path.join(output, "node"), 0o755);
    const result = spawnSync(path.join(output, "npm"), ["ci", "--omit=dev"], { env: { PATH: path.join(root, "missing") }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `false|${path.join(output, "lib", "npm", "bin", "npm-cli.js")}|ci|--omit=dev|`);
  }));
});
