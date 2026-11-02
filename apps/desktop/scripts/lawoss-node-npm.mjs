// 🟡 LAWOSS: npm vedľa pribaleného Node. Doplnky z LAWOSS Marketplace spúšťajú
// `node scripts/run.mjs`, ktorý pri prvom štarte volá `npm ci`. Pribalený Node je
// v PATH enginu (childProcessPath), npm z rovnakého overeného archívu nodejs.org
// tam teda musí byť tiež, inak doplnky na počítači bez Node nenabehnú.
import { lstat, mkdir, readFile, readdir, rm, writeFile, copyFile, chmod } from "node:fs/promises";
import path from "node:path";

// Nie `node_modules/npm`: electron-builder v extraResources vždy vynechá koreňový
// `node_modules` (app-builder-lib util/filter.js); vnorené `lib/npm/node_modules` prenesie.
export const NPM_DIRECTORY = path.join("lib", "npm");

const POSIX_SHIM = `#!/bin/sh\nnpm_config_update_notifier=false exec "\${0%/*}/node" "\${0%/*}/lib/npm/bin/npm-cli.js" "$@"\n`;
const WINDOWS_SHIM = `@ECHO off\r\nSETLOCAL\r\nSET npm_config_update_notifier=false\r\n"%~dp0node.exe" "%~dp0lib\\npm\\bin\\npm-cli.js" %*\r\n`;

// Bez `dirname` a bez `#!/usr/bin/env node`: kontrola balíka spúšťa npm len s
// priečinkom Node v PATH. Kontrola novej verzie npm je vypnutá, pribalený npm
// sa aktualizuje s aplikáciou.
export function npmShim(isWindows) {
  return isWindows ? { name: "npm.cmd", content: WINDOWS_SHIM } : { name: "npm", content: POSIX_SHIM };
}

// npm nepotrebuje vlastné `.bin` odkazy; symbolické odkazy by electron-builder
// nemusel preniesť, preto sa kopírujú len bežné súbory.
function skipped(relative) {
  return relative.split(/[\\/]/).includes(".bin");
}

export function npmZipEntry(archiveName, entry) {
  const prefix = `${archiveName}/node_modules/npm/`;
  return entry.startsWith(prefix) && !entry.endsWith("/") && !skipped(entry.slice(prefix.length));
}

async function copyRegularTree(source, destination, relative = "") {
  await mkdir(path.join(destination, relative), { recursive: true });
  for (const entry of await readdir(path.join(source, relative), { withFileTypes: true })) {
    const child = relative ? path.join(relative, entry.name) : entry.name;
    if (skipped(child) || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await copyRegularTree(source, destination, child);
    else if (entry.isFile()) await copyFile(path.join(source, child), path.join(destination, child));
  }
}

async function finish(output, isWindows) {
  const shim = npmShim(isWindows);
  await writeFile(path.join(output, shim.name), shim.content, "utf8");
  if (!isWindows) await chmod(path.join(output, shim.name), 0o755);
  const version = await bundledNpmVersion(output, isWindows);
  if (!version) throw new Error("Node archive is missing a usable npm");
  return { version };
}

// Unix: `<archív>/lib/node_modules/npm` rozbalený tar-om.
export async function installNpmFromDirectory(source, output, isWindows = false) {
  const target = path.join(output, NPM_DIRECTORY);
  await rm(target, { recursive: true, force: true });
  await copyRegularTree(source, target);
  return finish(output, isWindows);
}

// Windows: položky `<archív>/node_modules/npm/**` z unzipSync.
export async function installNpmFromZip(files, archiveName, output) {
  const target = path.join(output, NPM_DIRECTORY);
  await rm(target, { recursive: true, force: true });
  const prefix = `${archiveName}/node_modules/npm/`;
  for (const [entry, bytes] of Object.entries(files)) {
    if (!npmZipEntry(archiveName, entry)) continue;
    const parts = entry.slice(prefix.length).split("/");
    if (parts.some((part) => !part || part === "." || part === "..")) throw new Error(`Unsafe npm archive entry: ${entry}`);
    const destination = path.join(target, ...parts);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  return finish(output, true);
}

// Verzia npm, ak je pribalený celý: aktuálny spúšťací skript a npm-cli.js ako bežné súbory.
export async function bundledNpmVersion(output, isWindows = process.platform === "win32") {
  const regular = async (file) => (await lstat(file).catch(() => null))?.isFile() === true;
  const root = path.join(output, NPM_DIRECTORY);
  const shim = npmShim(isWindows);
  if (!(await regular(path.join(output, shim.name))) || !(await regular(path.join(root, "bin", "npm-cli.js")))) return null;
  try {
    if ((await readFile(path.join(output, shim.name), "utf8")) !== shim.content) return null;
    const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    return typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version) ? version : null;
  } catch {
    return null;
  }
}
