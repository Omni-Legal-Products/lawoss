import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { openuiLicenseNotices } from "./scripts/openui-license-notices";

/**
 * Build config for the Word add-in task pane bundle.
 *
 * Separate from vite.config.ts on purpose: the task pane is served by
 * legalwork-server under /word-addin (hence the base path) and always runs
 * as a "web" deployment (it talks to the server that serves it, and reaches
 * OpenCode through the server's /opencode proxy).
 */
const appRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const appPackagePath = resolve(appRoot, "package.json");
const desktopPackagePath = resolve(appRoot, "..", "desktop", "package.json");

function readPackageVersion(packagePath: string): string | null {
  if (!existsSync(packagePath)) return null;

  const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };
  return parsed.version?.trim() || null;
}

const buildAppVersion =
  process.env.VITE_LEGALWORK_APP_VERSION?.trim() ||
  readPackageVersion(desktopPackagePath) ||
  readPackageVersion(appPackagePath) ||
  "0.0.0";

// LAWOSS: the task pane does not ship the xlsx/pptx editors (Univer,
// pptx-react-viewer). Parsing them pushed the watch build past the default
// Node heap; the stub shows "open in the LAWOSS app" instead. See PATCHES.md.
const officeEditorStub = resolve(appRoot, "src/lawoss/word-addin/office-editor-stub.tsx");
function lawossOfficeEditorStub(): Plugin {
  return {
    name: "lawoss-office-editor-stub",
    enforce: "pre",
    resolveId: (source) => /(^|\/)artifact-(xlsx|pptx)-editor$/.test(source) ? officeEditorStub : null,
  };
}

export default defineConfig({
  base: "/word-addin/",
  define: {
    "import.meta.env.VITE_LEGALWORK_APP_VERSION": JSON.stringify(buildAppVersion),
    "import.meta.env.VITE_LEGALWORK_DEPLOYMENT": JSON.stringify("web"),
  },
  plugins: [
    lawossOfficeEditorStub(),
    openuiLicenseNotices(),
    tailwindcss(),
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", { compilationMode: "annotation" }]],
      },
    }),
  ],
  build: {
    target: "esnext",
    outDir: "dist-word-addin",
    // Watch mode (dev) keeps the previous bundle on disk so the task pane
    // never 404s/503s during the initial rebuild after `pnpm dev` starts.
    emptyOutDir: process.env.LEGALWORK_PANE_KEEP_DIST !== "1",
    rollupOptions: {
      input: {
        taskpane: resolve(appRoot, "taskpane.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@openuidev/devtools": resolve(appRoot, "../../packages/openui/src/devtools-disabled.ts"),
      "@": resolve(appRoot, "src"),
    },
  },
});
