import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  createOpenComputerUseIntegration,
  extractOpenComputerUseRelease,
  OPEN_COMPUTER_USE_VERSION,
  openComputerUseRelease,
  parseOpenComputerUseRunningApps,
} from "./open-computer-use.mjs";

const directories = [];
async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "legalwork-ocu-test-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Open Computer Use desktop runtime", () => {
  it("selects the upstream Mac archive and bundled Windows executables", () => {
    assert.equal(openComputerUseRelease("darwin", "x64").name, openComputerUseRelease("darwin", "arm64").name);
    assert.match(openComputerUseRelease("win32", "x64").name, /windows-amd64\.exe$/);
    assert.match(openComputerUseRelease("win32", "arm64").name, /windows-arm64\.exe$/);
    assert.throws(() => openComputerUseRelease("linux", "x64"), /Mac and Windows/);
    assert.throws(() => openComputerUseRelease("win32", "ia32"), /Intel or ARM64/);
  });

  it("rejects tampered downloads before extraction, shares concurrent installs, and allows retry", async () => {
    const directory = await temporaryDirectory();
    let bundledLoads = 0;
    let extractions = 0;
    const runtime = createOpenComputerUseIntegration({
      getDataDir: () => directory,
      platform: "win32",
      arch: "x64",
      download: async () => { throw new Error("Windows must not download a release"); },
      bundledWindows: async () => { bundledLoads += 1; return new Uint8Array([1, 2, 3]); },
      extract: async () => { extractions += 1; },
    });
    const outcomes = await Promise.allSettled([runtime.mcpConfig(), runtime.mcpConfig()]);
    assert.ok(outcomes.every((outcome) => outcome.status === "rejected" && /integrity/.test(outcome.reason.message)));
    assert.equal(bundledLoads, 1);
    assert.equal(extractions, 0);
    assert.deepEqual(await readdir(path.join(directory, "integrations", "open-computer-use")), []);
    await assert.rejects(runtime.mcpConfig(), /integrity/);
    assert.equal(bundledLoads, 2);
    assert.equal((await runtime.status()).installed, false);
  });

  it("verifies and installs both bundled Windows binaries", async () => {
    const directory = await temporaryDirectory();
    for (const arch of ["x64", "arm64"]) {
      const release = openComputerUseRelease("win32", arch);
      const bundled = await readFile(new URL(`./vendor/open-computer-use/${release.name}`, import.meta.url));
      assert.equal(createHash("sha256").update(bundled).digest("hex"), release.sha256);
      assert.equal(bundled.subarray(0, 2).toString(), "MZ");
      const runtime = createOpenComputerUseIntegration({ getDataDir: () => directory, platform: "win32", arch });
      const config = await runtime.mcpConfig();
      assert.deepEqual(await readFile(config.command[0]), bundled);
      assert.match(config.command[0], /1\.1\.0-capture1-win32-/);
    }
    await assert.rejects(extractOpenComputerUseRelease("unused.zip", directory, "win32"), /Only the Mac/);
  });

  it("reuses an installed binary by absolute path without invoking a package manager", async () => {
    const directory = await temporaryDirectory();
    const binary = await installedBinary(directory, "win32");
    const runtime = createOpenComputerUseIntegration({
      getDataDir: () => directory, platform: "win32", arch: "x64",
      download: async () => { throw new Error("Should not download a cached runtime"); },
    });
    const config = await runtime.mcpConfig();
    assert.deepEqual(config.command, [binary, "mcp"]);
    assert.match(config.environment.OPEN_COMPUTER_USE_AGENT_SOCKET_NAMESPACE, /^legalwork-.+-ocu-1\.1\.0$/);
    assert.deepEqual(await runtime.status(), { version: OPEN_COMPUTER_USE_VERSION, platform: "win32", installed: true, ready: true });
  });

  it("uses the Open Computer Use Mac helper's permission report", async () => {
    const directory = await temporaryDirectory();
    const binary = await installedBinary(directory, "darwin");
    const runtime = createOpenComputerUseIntegration({
      getDataDir: () => directory, platform: "darwin", arch: "x64",
      doctor: async (executable) => {
        assert.equal(executable, binary);
        return { accessibilityTrusted: true, screenCaptureGranted: false };
      },
    });
    assert.deepEqual(await runtime.status(), {
      version: OPEN_COMPUTER_USE_VERSION, platform: "darwin", installed: true,
      ready: false, accessibility: true, screenRecording: false,
    });
    const broken = createOpenComputerUseIntegration({
      getDataDir: () => directory, platform: "darwin", arch: "x64",
      doctor: async () => { throw new Error("Helper could not start"); },
    });
    assert.equal((await broken.status()).ready, false);
    assert.equal((await broken.status()).error, "Helper could not start");
  });

  it("separates helper sessions belonging to different LegalWork installations", async () => {
    const first = await temporaryDirectory();
    const second = await temporaryDirectory();
    await installedBinary(first, "darwin");
    await installedBinary(second, "darwin");
    const a = createOpenComputerUseIntegration({ getDataDir: () => first, platform: "darwin", arch: "x64" });
    const b = createOpenComputerUseIntegration({ getDataDir: () => second, platform: "darwin", arch: "x64" });
    assert.notDeepEqual((await a.mcpConfig()).environment, (await b.mcpConfig()).environment);
  });

  it("lists apps with the replacement runtime and never installs it from a mention query", async () => {
    const directory = await temporaryDirectory();
    let queried = 0;
    const runtime = createOpenComputerUseIntegration({
      getDataDir: () => directory, platform: "darwin", arch: "x64",
      download: async () => { throw new Error("A mention query must not install"); },
      runningApps: async (binary, env) => {
        queried += 1;
        assert.equal(binary, await installedBinary(directory, "darwin"));
        assert.match(env.OPEN_COMPUTER_USE_AGENT_SOCKET_NAMESPACE, /^legalwork-/);
        return ["Music", "TextEdit"];
      },
    });
    assert.deepEqual(await runtime.listRunningApps(), { ok: false, apps: [] });
    assert.equal(queried, 0);
    await installedBinary(directory, "darwin");
    assert.deepEqual(await runtime.listRunningApps(), { ok: true, apps: ["Music", "TextEdit"] });
    assert.equal(queried, 1);
  });

  it("offers running app names, excluding recently used apps and duplicates", () => {
    assert.deepEqual(parseOpenComputerUseRunningApps([
      "Visual Studio Code — com.microsoft.VSCode [frontmost, running, uses=20]",
      "Music — com.apple.Music [running]",
      "Music — com.apple.Music [running]",
      "Preview — com.apple.Preview [last-used=2026-10-14, uses=10]",
      "unrecognized output",
    ].join("\n")), ["Visual Studio Code", "Music"]);
  });
});

async function installedBinary(directory, platform) {
  const build = platform === "win32" ? `${OPEN_COMPUTER_USE_VERSION}-capture1` : OPEN_COMPUTER_USE_VERSION;
  const binary = path.join(directory, "integrations", "open-computer-use", `${build}-${platform}-x64`, openComputerUseRelease(platform, "x64").executable);
  await mkdir(path.dirname(binary), { recursive: true });
  await writeFile(binary, "runtime fixture");
  return binary;
}
