import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../server/src/server";
import type { ServerConfig } from "../../server/src/types";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";

/**
 * Windows uvoľní priečinok sledovaný cez fs.watch až chvíľu po close() pri
 * server.stop(); rm medzitým hlási EBUSY/EPERM. Na macOS a Linuxe prejde hneď.
 */
async function removeTree(path: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (attempt >= 20 || (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

export async function memoryFixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-ui-")));
  const prior = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE, runtimeDb: process.env.LEGALWORK_RUNTIME_DB };
  process.env.LEGALWORK_DATA_DIR = join(base, "data"); process.env.LEGALWORK_TOKEN_STORE = join(base, "tokens.json");
  // runtime.sqlite by inak vznikol vedľa server.json v `base` a server ho drží otvorený do konca
  // procesu; Windows otvorený súbor nezmaže (EBUSY). Jeden súbor pre celý beh testov mimo `base`.
  process.env.LEGALWORK_RUNTIME_DB = join(tmpdir(), `lawoss-ui-runtime-${process.pid}.sqlite`);
  const root = join(base, "office"), matter = join(root, "AK/S/A/Spisy/A"), vault = join(base, "vault");
  await mkdir(join(matter, ".lawoss"), { recursive: true }); await mkdir(vault);
  await writeFile(join(matter, "_memory.md"), "SYNTHETIC-A\nExisting memory\n");
  await writeFile(join(vault, "card.md"), "SYNTHETIC-A\nExisting card\n");
  const profile = { version: 1, matterId: "SYNTHETIC-A", roots: [{ id: "matter", path: "." }, { id: "vault", path: vault }], sources: [{ id: "memory", root: "matter", path: "_memory.md", role: "case_memory", required: true, writable: true, anchors: ["SYNTHETIC-A"] }, { id: "card", root: "vault", path: "card.md", role: "case_card", required: true, writable: false, anchors: ["SYNTHETIC-A"] }] };
  const content = JSON.stringify(profile);
  await writeFile(join(matter, ".lawoss/memory-profile.json"), content);
  const engineCalls: { method: string; path: string; directory: string | null }[] = [];
  const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url); const directory = url.searchParams.get("directory") ?? request.headers.get("x-opencode-directory");
    engineCalls.push({ method: request.method, path: url.pathname, directory });
    if (url.pathname === "/session" && request.method === "POST") return Response.json({ id: "synthetic-session", directory });
    if (url.pathname === "/global/health") return Response.json({ healthy: true, version: "1.18.29" });
    return Response.json({});
  } });
  const engineUrl = `http://127.0.0.1:${engine.port}`;
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(base, "server.json"), token: "synthetic-client", hostToken: "synthetic-host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [{ id: "office", name: "Office", preset: "starter", path: root, workspaceType: "local" }, { id: "matter", name: "Matter", preset: "starter", path: matter, workspaceType: "local" }], authorizedRoots: [root], opencodeBaseUrl: engineUrl, readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const server = await startServer(config), baseUrl = `http://127.0.0.1:${server.port}`;
  const client = createLegalworkServerClient({ baseUrl, token: "synthetic-client", hostToken: "synthetic-host" });
  return { base, root, matter, vault, content, profile, config, client, baseUrl, engineUrl, engineCalls, cleanup: async () => {
    await server.stop(); engine.stop(true); await removeTree(base);
    for (const [key, value] of Object.entries({ LEGALWORK_DATA_DIR: prior.data, LEGALWORK_TOKEN_STORE: prior.tokens, LEGALWORK_RUNTIME_DB: prior.runtimeDb })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  } };
}
