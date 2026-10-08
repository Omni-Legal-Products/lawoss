import { isAbsolute, relative, resolve, sep } from "node:path";
import { ApiError } from "../errors.js";

/** ZIP/catalog paths use forward slashes and must retain the same meaning on Windows. */
export function isSafeDocumentPath(name: string): boolean {
  if (!name || /[\\<>:"|?*\x00-\x1f]/.test(name)) return false;
  return name.split("/").every((part) =>
    part !== "" && part !== "." && part !== ".." && !/[. ]$/.test(part) &&
    !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(part.split(".")[0]!.trimEnd())
  );
}

/** Defense at the write boundary, independent of the archive parser. */
export function resolveDocumentPath(root: string, name: string): string {
  if (!isSafeDocumentPath(name)) throw new ApiError(400, "invalid_path", "Unsafe document path");
  const target = resolve(root, name);
  const child = relative(resolve(root), target);
  if (!child || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new ApiError(400, "invalid_path", "Document path escapes its directory");
  }
  return target;
}
