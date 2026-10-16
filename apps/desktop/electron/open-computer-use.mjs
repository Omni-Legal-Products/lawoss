import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export const OPEN_COMPUTER_USE_VERSION = "1.1.0";
const RELEASE_URL = `https://github.com/iFurySt/open-codex-computer-use/releases/download/v${OPEN_COMPUTER_USE_VERSION}`;

/** Select an upstream release, including its pinned GitHub asset digest. */
export function openComputerUseRelease(platform, arch) {
  if (arch !== "arm64" && arch !== "x64") throw new Error("Open Computer Use requires an Intel or ARM64 computer.");
  if (platform === "darwin") {
    return {
      name: "Open-Computer-Use-1.1.0-macOS-universal.app.zip",
      sha256: "5d37a1d760c37553dcecb3b505a8c8b36bfc389de4d46498cbcf6e6c88e7eb1a",
      executable: path.join("Open Computer Use.app", "Contents", "MacOS", "OpenComputerUse"),
    };
  }
  if (platform === "win32") {
    return {
      name: `open-computer-use-windows-${arch === "arm64" ? "arm64" : "amd64"}.exe`,
      sha256: arch === "arm64"
        ? "6f28edd710cfb0bd77fcfbc4cf00e35ede73f146caa075a40e541af268921de9"
        : "302ec6f4b8cc2cf768641f8d0326d14740ed366e304c4d1efe4401da4d4ffe46",
      executable: "open-computer-use.exe",
    };
  }
  throw new Error("Open Computer Use is available in LegalWork Desktop on Mac and Windows.");
}

async function fetchRelease(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`Could not download Open Computer Use (HTTP ${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function extractOpenComputerUseRelease(archivePath, destination, platform) {
  if (platform !== "darwin") throw new Error("Only the Mac Open Computer Use release is an archive.");
  // ditto preserves the signed app bundle's executable modes and metadata.
  await run("/usr/bin/ditto", ["-x", "-k", archivePath, destination], { timeout: 30_000 });
}

async function readBundledWindowsRuntime(name) {
  return readFile(new URL(`./vendor/open-computer-use/${name}`, import.meta.url));
}

async function readDoctor(binary, environment) {
  const { stdout } = await run(binary, ["doctor", "--json"], {
    env: { ...process.env, ...environment },
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return JSON.parse(String(stdout));
}

async function readRunningApps(binary, environment) {
  const { stdout } = await run(binary, ["list-apps"], {
    env: { ...process.env, ...environment }, timeout: 10_000, maxBuffer: 1024 * 1024,
  });
  return parseOpenComputerUseRunningApps(String(stdout));
}

/** Upstream also lists recently used apps. The composer offers running apps. */
export function parseOpenComputerUseRunningApps(output) {
  return [...new Set(output.split("\n").flatMap((line) => {
    const match = line.match(/^(.+) — .+ \[([^\]]*)\]$/);
    return match && match[2].split(", ").includes("running") ? [match[1]] : [];
  }))];
}

/**
 * @param {{
 *   getDataDir: () => string,
 *   platform?: string,
 *   arch?: string,
 *   download?: (url: string) => Promise<Uint8Array>,
 *   bundledWindows?: (name: string) => Promise<Uint8Array>,
 *   extract?: (archive: string, destination: string, platform: string) => Promise<void>,
 *   doctor?: (binary: string, environment: Record<string, string>) => Promise<unknown>,
 *   runningApps?: (binary: string, environment: Record<string, string>) => Promise<string[]>
 * }} options
 */
export function createOpenComputerUseIntegration({
  getDataDir,
  platform = process.platform,
  arch = process.arch,
  download = fetchRelease,
  bundledWindows = readBundledWindowsRuntime,
  extract = extractOpenComputerUseRelease,
  doctor = readDoctor,
  runningApps = readRunningApps,
}) {
  /** @type {Promise<string> | undefined} */
  let installing;

  function runtimePaths() {
    const release = openComputerUseRelease(platform, arch);
    const root = path.join(getDataDir(), "integrations", "open-computer-use");
    // A new directory ensures existing v1.1.0 Windows installs use the patched runtime.
    const build = platform === "win32" ? `${OPEN_COMPUTER_USE_VERSION}-capture1` : OPEN_COMPUTER_USE_VERSION;
    const directory = path.join(root, `${build}-${platform}-${arch}`);
    return { release, root, directory, binary: path.join(directory, release.executable) };
  }

  function environment() {
    // Keep the upstream macOS agent separate from other MCP clients and dev installations.
    const namespace = createHash("sha256").update(getDataDir()).digest("hex").slice(0, 12);
    return { OPEN_COMPUTER_USE_AGENT_SOCKET_NAMESPACE: `legalwork-${namespace}-ocu-${OPEN_COMPUTER_USE_VERSION}` };
  }

  async function install() {
    const { release, root, directory, binary } = runtimePaths();
    if (existsSync(binary)) return binary;
    await mkdir(root, { recursive: true });
    const staging = await mkdtemp(path.join(root, ".install-"));
    try {
      const artifact = platform === "win32"
        ? await bundledWindows(release.name)
        : await download(`${RELEASE_URL}/${release.name}`);
      if (createHash("sha256").update(artifact).digest("hex") !== release.sha256) {
        throw new Error("Open Computer Use runtime failed its integrity check. Please try again.");
      }
      const extracted = path.join(staging, "runtime");
      await mkdir(extracted);
      if (platform === "win32") {
        await writeFile(path.join(extracted, release.executable), artifact);
      } else {
        const archivePath = path.join(staging, "release.zip");
        await writeFile(archivePath, artifact);
        await extract(archivePath, extracted, platform);
      }
      if (!existsSync(path.join(extracted, release.executable))) {
        throw new Error("The Open Computer Use archive is missing its runtime.");
      }
      // A failed/partial install never becomes the configured MCP command.
      await rm(directory, { recursive: true, force: true });
      await rename(extracted, directory);
      return binary;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  function ensureInstalled() {
    installing ??= install().finally(() => { installing = undefined; });
    return installing;
  }

  /** @returns {Promise<import("@legalwork/types/desktop-ipc").OpenComputerUseStatus>} */
  async function status() {
    const { binary } = runtimePaths();
    const installed = existsSync(binary);
    const result = { version: OPEN_COMPUTER_USE_VERSION, platform, installed, ready: installed };
    if (!installed || platform !== "darwin") return result;
    try {
      const permissions = await doctor(binary, environment());
      if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
        throw new Error("Open Computer Use returned an unreadable permission status.");
      }
      const accessibility = "accessibilityTrusted" in permissions && permissions.accessibilityTrusted === true;
      const screenRecording = "screenCaptureGranted" in permissions && permissions.screenCaptureGranted === true;
      return { ...result, ready: accessibility && screenRecording, accessibility, screenRecording };
    } catch (error) {
      return { ...result, ready: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function openPermissionSetup() {
    if (platform !== "darwin") return;
    const binary = await ensureInstalled();
    await new Promise((resolve, reject) => {
      const child = spawn(binary, ["doctor"], {
        env: { ...process.env, ...environment() },
        detached: true,
        stdio: "ignore",
      });
      child.once("error", reject);
      child.once("spawn", () => { child.unref(); resolve(undefined); });
    });
  }

  return {
    status,
    openPermissionSetup,
    async listRunningApps() {
      if (platform !== "darwin") return { ok: false, apps: [] };
      const { binary } = runtimePaths();
      if (!existsSync(binary)) return { ok: false, apps: [] };
      try {
        return { ok: true, apps: await runningApps(binary, environment()) };
      } catch {
        return { ok: false, apps: [] };
      }
    },
    async mcpConfig() {
      return { command: [await ensureInstalled(), "mcp"], environment: environment() };
    },
  };
}
