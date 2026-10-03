import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Probe actual filesystem privileges; an unexpected I/O error must still fail. */
export function symlinkSkipReason(type: "file" | "dir"): string | false {
  const root = mkdtempSync(join(tmpdir(), "lawoss-symlink-probe-"));
  try {
    const target = join(root, "target");
    if (type === "dir") mkdirSync(target);
    else writeFileSync(target, "synthetic probe");
    symlinkSync(target, join(root, "link"), type);
    return false;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && ["EACCES", "EPERM", "ENOTSUP"].includes(String(error.code))) {
      return `${type} symlink capability unavailable (${String(error.code)})`;
    }
    throw error;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
