// cmake-js 7.4's CLI starts compile() and only calls process.exit on rejection.
// On the Windows ARM64 runner the header download settles without a live
// handle, Node exits 0, and no sherpa-onnx.node is produced. Compile in this
// process with a referenced timer, and install Node headers ourselves first.
import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export function nodeDistributionDir(version, arch, home) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Node distribution version required");
  if (!["arm64", "x64", "ia32"].includes(arch)) throw new Error("Node distribution arch required");
  return path.join(home, ".cmake-js", `node-${arch}`, `v${version}`);
}

export function windowsNodeLibRelative(arch) {
  if (arch === "arm64") return "win-arm64/node.lib";
  if (arch === "x64") return "win-x64/node.lib";
  return "win-x86/node.lib";
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function checksums(text) {
  const map = new Map();
  for (const line of String(text).split(/\n/)) {
    const match = /^([a-f0-9]{64})\s+(\S+)/.exec(line.trim());
    if (match) map.set(match[2], match[1]);
  }
  return map;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export async function ensureNodeDistribution({ version, arch, home = homedir(), fetchFile, extractArchive }) {
  const dir = nodeDistributionDir(version, arch, home);
  const header = path.join(dir, "include", "node", "node.h");
  const lib = path.join(dir, ...windowsNodeLibRelative(arch).split("/"));
  if ((await exists(header)) && (await exists(lib))) return { dir, downloaded: false };
  const base = `https://nodejs.org/dist/v${version}`;
  const headerName = `node-v${version}-headers.tar.gz`;
  const libName = windowsNodeLibRelative(arch);
  const sums = checksums(Buffer.from(await fetchFile(`${base}/SHASUMS256.txt`)).toString("utf8"));
  const headerBytes = Buffer.from(await fetchFile(`${base}/${headerName}`));
  if (sums.get(headerName) !== sha256(headerBytes)) throw new Error(`Checksum mismatch: ${headerName}`);
  await mkdir(dir, { recursive: true });
  await extractArchive(headerBytes, dir);
  const libBytes = Buffer.from(await fetchFile(`${base}/${libName}`));
  if (sums.get(libName) !== sha256(libBytes)) throw new Error(`Checksum mismatch: ${libName}`);
  await mkdir(path.dirname(lib), { recursive: true });
  await writeFile(lib, libBytes);
  if (!(await exists(header)) || !(await exists(lib))) throw new Error("Node distribution for the speech addon is incomplete");
  return { dir, downloaded: true };
}

export async function compileCMakeJsAddon({ compile, artifactExists, deadlineMs = 600_000 }) {
  if (typeof compile !== "function" || typeof artifactExists !== "function") throw new Error("Speech compile input required");
  const keepalive = setInterval(() => {}, 1_000);
  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Windows ARM64 speech compile timed out")), deadlineMs);
      Promise.resolve().then(() => compile()).then(resolve, reject);
    });
  } finally {
    clearInterval(keepalive);
    clearTimeout(timer);
  }
  if (!(await artifactExists())) throw new Error("Windows ARM64 speech addon was not produced");
}
