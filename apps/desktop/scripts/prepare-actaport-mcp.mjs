import { spawnSync } from "node:child_process";
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(desktopRoot, "../..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(pnpm, ["--filter", "@legalwork/actaport-mcp", "build"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const output = path.join(desktopRoot, "resources", "actaport-mcp");
await mkdir(output, { recursive: true });
for (const file of ["index.mjs", "auth.mjs"]) {
  const source = path.join(root, "packages", "actaport-mcp", "dist", file);
  if ((await stat(source)).size === 0) throw new Error(`Actaport bundle is empty: ${source}`);
  await copyFile(source, path.join(output, file));
}
console.log("Actaport MCP and credential authentication bundled for the desktop runtime.");
