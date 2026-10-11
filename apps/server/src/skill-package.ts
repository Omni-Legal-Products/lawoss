import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { ApiError } from "./errors.js";
import { checkedPath, safeRelative } from "./agent-sandbox/files.js";
import { docxEvidence } from "./reviews/evidence.js";

const MAX_BYTES = 32_000_000;
const visible = (path: string) => safeRelative(path) && path.split("/").every(part => !part.startsWith(".") && part !== "__pycache__");

export async function skillPackageDirectory(skillPath: string): Promise<string> {
  const directory = dirname(skillPath);
  if (!(await lstat(directory)).isDirectory()) throw new ApiError(422, "skill_package", "Skill packages must be regular directories, not links.");
  return realpath(directory);
}

/** Read only a regular file inside the selected package. Never follow a resource link. */
async function packageBytes(directory: string, path: string): Promise<Buffer> {
  if (!visible(path)) throw new ApiError(400, "skill_resource_path", "Use a relative file reference from the loaded skill package.");
  const absolute = await checkedPath({ source: directory, target: "/skills/0", writable: false }, path, false);
  const info = await lstat(absolute);
  if (!info.isFile()) throw new ApiError(422, "skill_package", "Skill resources must be regular files, not links.");
  if (info.size > MAX_BYTES) throw new ApiError(413, "skill_package_size", "Skill resources must be at most 32 MB.");
  const file = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await file.stat();
    if (opened.dev !== info.dev || opened.ino !== info.ino || !opened.isFile() || opened.size > MAX_BYTES || await realpath(absolute) !== absolute)
      throw new ApiError(409, "skill_package_changed", "The skill resource changed. Load the workflow again.");
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await file.stat();
    if (offset !== bytes.length || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || await realpath(absolute) !== absolute)
      throw new ApiError(409, "skill_package_changed", "The skill resource changed. Retry the read.");
    return bytes;
  } finally { await file.close(); }
}

/** One walk supplies both the pinned version and the complete resource inventory. */
export async function inspectSkillPackage(skillPath: string) {
  const directory = await skillPackageDirectory(skillPath);
  const hash = createHash("sha256");
  const files: Array<{ path: string; size: number }> = [];
  let size = 0;
  async function walk(prefix: string) {
    for (const entry of (await readdir(join(directory, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || entry.name === "__pycache__") continue;
      const path = `${prefix}${entry.name}`;
      if (!visible(path) || entry.isSymbolicLink()) throw new ApiError(422, "skill_dependency", "Skill dependencies must not contain symbolic links or unsafe paths.");
      if (entry.isDirectory()) { await walk(`${path}/`); continue; }
      const bytes = await packageBytes(directory, path);
      size += bytes.length;
      if (size > MAX_BYTES || files.length >= 10000) throw new ApiError(422, "skill_dependency", "Skill package is too large to pin.");
      hash.update(path).update("\0").update(bytes).update("\0");
      files.push({ path, size: bytes.length });
    }
  }
  await walk("");
  return { directory, files, hash: hash.digest("hex") };
}

/** Extraction never executes a package helper or changes the installed files. */
export async function readSkillPackageFile(skillPath: string, expectedDirectory: string, path: string, offset = 0) {
  const directory = await skillPackageDirectory(skillPath);
  if (directory !== expectedDirectory) throw new ApiError(409, "skill_package_changed", "The skill moved or was replaced by another package. Load it again.");
  const bytes = await packageBytes(directory, path);
  const pages = extname(path).toLowerCase() === ".docx" ? docxEvidence(bytes) : null;
  let text: string;
  try { text = pages ? pages.map(page => page.text).join("\n\n") : new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new ApiError(415, "skill_resource_binary", "Use the skill's read-only sandbox mount for this binary file."); }
  if (text.includes("\0")) throw new ApiError(415, "skill_resource_binary", "Use the skill's read-only sandbox mount for this binary file.");
  const end = Math.min(offset + 24000, text.length);
  return { path, directory, content: text.slice(offset, end), totalCharacters: text.length,
    ...(end < text.length ? { nextOffset: end } : {}),
    complete: pages ? pages.every(page => page.status === "complete") : true,
    ...(pages?.some(page => page.status !== "complete") ? { notice: "Word drawings or tracked changes need visual review. Text alone may be incomplete." } : {}),
  };
}
