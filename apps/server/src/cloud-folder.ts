import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, posix, resolve, win32 } from "node:path";
import { promisify } from "node:util";
import { isWindowsCloudFolder } from "./cloud-folder-windows.js";

const exec = promisify(execFile);
const knownConfigRoots = new Map<string, string[]>();
const configWarnings = new Set<string>();

export function isWithinCloudRoot(path: string, roots: string[], platform = process.platform): boolean {
  const paths = platform === "win32" ? win32 : posix;
  if (!paths.isAbsolute(path)) return false;
  const normalize = (value: string) => {
    const normalized = paths.normalize(value).replace(/[\\/]+$/, "");
    return platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  const target = normalize(path);
  return roots.some(root => paths.isAbsolute(root) && (target === normalize(root) || target.startsWith(normalize(root) + paths.sep)));
}

export function isMacCloudFolder(path: string, userHome: string): boolean {
  return isWithinCloudRoot(path, [posix.join(userHome, "Library", "CloudStorage"), posix.join(userHome, "Library", "Mobile Documents", "com~apple~CloudDocs")], "darwin");
}

async function readConfig(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return undefined;
    throw error;
  }
}

function dropboxRoots(source: string): string[] {
  const data: unknown = JSON.parse(source);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid Dropbox folder configuration");
  return Object.values(data).flatMap(account => account && typeof account === "object" && "path" in account && typeof account.path === "string" ? [account.path] : []);
}

async function optionalConfigRoots(path: string, parse: (source: string) => string[]): Promise<string[]> {
  try {
    const source = await readConfig(path);
    // Clients may briefly remove their settings during an atomic replacement.
    if (source === undefined) return knownConfigRoots.get(path) ?? [];
    const roots = parse(source);
    knownConfigRoots.set(path, roots);
    configWarnings.delete(path);
    return roots;
  } catch {
    // One broken hint must not cancel the OS probe or other clients' roots.
    // Keep positives already learned in this process during transient failures.
    if (!configWarnings.has(path)) {
      console.warn(`[cloud-folder] Could not inspect ${basename(path)}; retaining known roots and continuing other cloud checks.`);
      configWarnings.add(path);
    }
    return knownConfigRoots.get(path) ?? [];
  }
}

// QSettings INI strings can quote commas/spaces and escape Unicode or slashes.
// Parse only folder localPath keys, never server URLs or account credentials.
export function syncClientRoots(source: string): string[] {
  let section = "";
  const roots: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    const header = line.trim().match(/^\[([^\]]+)\]$/);
    if (header) { section = header[1]; continue; }
    if (section !== "Accounts") continue;
    const entry = line.match(/^\s*[^=\\]+\\(?:Folders|FoldersWithPlaceholders|Multifolders)\\[^=\\]+\\localPath\s*=(.*)$/);
    if (!entry) continue;
    const value = entry[1].trim().replace(/^"(.*)"$/, "$1");
    // Qt 5 also wrote UTF-8 bytes as consecutive hex escapes. Decode those
    // before the Qt 6 UTF-16 escapes, retaining non-UTF-8 sequences below.
    const unicode = value.replace(/(?:\\x[89a-fA-F][0-9a-fA-F]){2,}/g, escaped => {
      const bytes = Uint8Array.from(escaped.split("\\x").slice(1), byte => parseInt(byte, 16));
      try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { return escaped; }
    });
    roots.push(unicode.replace(/\\(x[0-9a-fA-F]{1,4}|[0-7]{1,3}|[\\"])/g, (_, escape: string) => {
      if (escape === "\\" || escape === '"') return escape;
      return String.fromCharCode(parseInt(escape.startsWith("x") ? escape.slice(1) : escape, escape.startsWith("x") ? 16 : 8));
    }));
  }
  return roots;
}

/** Read only known client configuration files outside project folders. */
export async function configuredCloudRoots(platform: NodeJS.Platform, userHome: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const paths = platform === "win32" ? win32 : posix;
  const dropbox = platform === "win32"
    ? [env.APPDATA || paths.join(userHome, "AppData", "Roaming"), env.LOCALAPPDATA || paths.join(userHome, "AppData", "Local")].map(path => paths.join(path, "Dropbox", "info.json"))
    : [paths.join(userHome, ".dropbox", "info.json")];
  const config = platform === "darwin"
    ? [paths.join(userHome, "Library", "Preferences"), paths.join(userHome, "Library", "Containers", "com.nextcloud.desktopclient", "Data", "Library", "Preferences")]
    : [platform === "win32" ? env.APPDATA || paths.join(userHome, "AppData", "Roaming") : env.XDG_CONFIG_HOME || paths.join(userHome, ".config")];
  const clients = config.flatMap(root => [paths.join(root, "Nextcloud", "nextcloud.cfg"), paths.join(root, "ownCloud", "owncloud.cfg"), paths.join(root, "ownCloud", "ownCloud.cfg")]);
  const results = await Promise.all([
    ...dropbox.map(path => optionalConfigRoots(path, dropboxRoots)),
    ...clients.map(path => optionalConfigRoots(path, syncClientRoots)),
  ]);
  return [...new Set(results.flat())].filter(path => paths.isAbsolute(path));
}

/** Metadata only; never enumerate or open the folder's documents. */
export async function isCloudFolder(path: string): Promise<boolean> {
  const userHome = homedir();
  const absolute = resolve(path);
  const canonical = await realpath(absolute).catch(() => absolute);
  if (process.platform === "darwin" && (isMacCloudFolder(absolute, userHome) || isMacCloudFolder(canonical, userHome))) return true;
  const roots = await configuredCloudRoots(process.platform, userHome, process.env);
  if (isWithinCloudRoot(absolute, roots) || isWithinCloudRoot(canonical, roots)) return true;
  // A configured sync root can itself be a link into a different volume.
  const resolved = await Promise.all(roots.map(root => realpath(root).catch(() => root)));
  if (isWithinCloudRoot(canonical, resolved)) return true;
  if (process.platform === "win32") return await isWindowsCloudFolder(canonical);
  if (process.platform === "darwin") {
    // Legacy Google Drive streams use a dedicated filesystem, at any mount
    // location. stat reads directory metadata, not a file in the project.
    const { stdout } = await exec("/usr/bin/stat", ["-f", "%T", canonical], { timeout: 5_000 });
    return stdout.trim() === "dfsfuse_DFS";
  }
  return false;
}
