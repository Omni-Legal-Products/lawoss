import { createRequire } from "node:module";
import { readFileSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Keep required notices in distribution artifacts, not checked-in generated pages. */
export function openuiLicenseNotices(): Plugin {
  return { name: "openui-license-notices", apply: "build", generateBundle() {
    const visited = new Set<string>();
    const entries: string[] = [];
    function visit(name: string, from: string) {
      const require = createRequire(join(from, "package.json"));
      const candidate = (require.resolve.paths("legalwork-license-lookup") ?? [])
        .map(directory => join(directory, name, "package.json")).find(existsSync);
      if (!candidate) throw new Error(`Cannot resolve ${name}`);
      const file = realpathSync(candidate);
      const pkg: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (!record(pkg) || typeof pkg.name !== "string" || typeof pkg.version !== "string") throw new Error(`Invalid manifest: ${file}`);
      const key = `${pkg.name}@${pkg.version}`;
      if (visited.has(key)) return;
      visited.add(key);
      const directory = dirname(file);
      const notices = readdirSync(directory).filter(name => /^(licen[cs]e|notice|copying)([.-]|$)/i.test(name));
      const text = notices.map(name => `${name}\n${readFileSync(join(directory, name), "utf8")}`).join("\n\n");
      const license = (typeof pkg.license === "string" ? pkg.license : undefined)
        ?? (Array.isArray(pkg.licenses) ? pkg.licenses.filter(record).map(entry => entry.type).join(" OR ") : undefined)
        ?? (pkg.name === "@ag-ui/core" && pkg.version === "0.0.53" && text.startsWith("LICENSE\nMIT License\n") ? "MIT (LICENSE file)" : undefined);
      if (!license) throw new Error(`Review the license of ${key} before distributing.`);
      entries.push(`===== ${key} (${JSON.stringify(license)}) =====\n${text || `License declaration: ${JSON.stringify(license)}. Source: ${JSON.stringify(pkg.repository ?? pkg.homepage ?? "")}`}`);
      for (const dependency of Object.keys(record(pkg.dependencies) ? pkg.dependencies : {})) visit(dependency, directory);
    }
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/openui");
    for (const name of ["@openuidev/react-lang", "@openuidev/react-ui", "@openuidev/react-headless"]) visit(name, root);
    this.emitFile({ type: "asset", fileName: "OPENUI_NOTICES.txt", source:
      "OpenUI dependency licenses and notices. Dependencies retain their original licenses.\nFor dual-licensed dependencies offering MIT, this distribution uses the MIT option.\n\n"
      + entries.sort().join("\n\n").replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "") });
  } };
}
