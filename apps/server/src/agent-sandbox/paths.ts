import type { SandboxMount } from "./vm.js";

/** Translate only complete mounted path prefixes, never an unrelated sibling.
 * Keep the original command for permission review; execute against the same
 * authorized files using their guest names. Longest prefixes win for skills
 * nested inside the workspace. */
export function sandboxPaths(value: string, mounts: Pick<SandboxMount, "source" | "target">[]) {
  const mapping = [...mounts].sort((a, b) => b.source.length - a.source.length);
  if (!mapping.length) return value;
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[\\s"'=:(])(${mapping.map(mount => escape(mount.source.replace(/\/$/, ""))).join("|")})(?=/|["']|$)`, "g");
  return value.replace(pattern, (_match, boundary: string, source: string) => `${boundary}${mapping.find(mount => mount.source.replace(/\/$/, "") === source)!.target}`);
}
