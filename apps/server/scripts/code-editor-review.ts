// Disposable workspace using the real read/write/stat routes, never user files.
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server";

const root = await mkdtemp(join(tmpdir(), "legalwork-code-editor-review-"));
for (const key of ["LEGALWORK_STORAGE_STORE", "LEGALWORK_TOKEN_STORE", "LEGALWORK_RUNTIME_DB", "LEGALWORK_ENV_STORE", "LEGALWORK_DATA_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME"])
  process.env[key] = join(root, key);
const files = {
  "matter.ts": 'interface Matter {\n  name: string;\n  status: "open" | "closed";\n}\n\n// Keep each matter in the firm workspace.\nexport function summarize(matter: Matter): string {\n  return `${matter.name}: ${matter.status}`;\n}\n',
  "config.json": '{\n  "name": "LegalWork",\n  "enabled": true\n}\n',
  "review.py": 'def summarize(matter):\n    """Summarize a matter locally."""\n    return f"{matter[\'name\']}: {matter[\'status\']}"\n',
  "Notes.md": "# Review notes\n\nThis is a synthetic note for autosave verification.\n",
  "Plain.txt": "Synthetic plain text for autosave verification.\n",
};
for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
const server = await startServer({
  host: "127.0.0.1", port: 5185, token: "code-editor-review-client", hostToken: "code-editor-review-owner",
  configPath: join(root, ".server-config.json"), approval: { mode: "auto", timeoutMs: 1000 },
  corsOrigins: ["http://localhost:5184", "http://127.0.0.1:5184"],
  workspaces: [{ id: "code-editor-review", name: "Editor review", path: root, preset: "default", workspaceType: "local" }],
  authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
});
console.log(JSON.stringify({ root, port: server.port }));
