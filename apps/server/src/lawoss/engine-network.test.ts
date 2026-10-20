import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CHATGPT_RECOMMENDED_MODELS,
  CHATGPT_SUBSCRIPTION_MODELS,
} from "../../../../lawoss/providers/chatgpt-subscription.mjs";
import { createManagedOpencodeServer } from "../managed-opencode.js";
import {
  CATALOG_FILE,
  LAWOSS_MODELS_CATALOG_ENV,
  PACKAGED_CATALOG_DIR,
  bundledModelsCatalogPath,
  lawossEngineEnv,
} from "./engine-network.js";

type Catalog = Record<string, { models?: Record<string, unknown> }>;

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporary.push(path);
  return path;
}

describe("LAWOSS: engine bez Eigenweltu", () => {
  test("sťahovanie katalógu, zdieľanie a aktualizácia sú vypnuté", () => {
    const env = lawossEngineEnv({});
    expect(env.OPENCODE_DISABLE_MODELS_FETCH).toBe("1");
    expect(env.OPENCODE_DISABLE_SHARE).toBe("1");
    expect(env.OPENCODE_DISABLE_AUTOUPDATE).toBe("1");
    // Žiadna sieťová adresa: engine dostane len prepínače a lokálnu cestu.
    expect(Object.values(env).filter((value) => /^[a-z]+:\/\//i.test(value))).toEqual([]);
  });

  test("pri vývoji a v testoch engine číta katalóg z repozitára", async () => {
    const path = bundledModelsCatalogPath({});
    expect(path).not.toBeNull();
    expect(path!.replaceAll("\\", "/")).toEndWith("lawoss/models-catalog/api.json");
    expect(lawossEngineEnv({}).OPENCODE_MODELS_PATH).toBe(path!);
  });

  test("pribalený katalóg obsahuje odporúčaný model predplatného ChatGPT", async () => {
    const catalog = JSON.parse(await readFile(bundledModelsCatalogPath({})!, "utf8")) as Catalog;
    const openai = Object.keys(catalog.openai?.models ?? {});
    expect(openai).toContain(CHATGPT_RECOMMENDED_MODELS[0]);
    // Aspoň jeden model, ktorý predplatné prijme, inak filter vráti celý zoznam OpenCode.
    expect(openai.filter((id) => CHATGPT_SUBSCRIPTION_MODELS.has(id)).length).toBeGreaterThan(0);
    expect(JSON.stringify(catalog)).not.toMatch(/eigenwelt/i);
  });

  test("v zabalenej appke leží katalóg vedľa app.asar", async () => {
    const resources = await tempDir("lawoss-resources-");
    await mkdir(join(resources, PACKAGED_CATALOG_DIR), { recursive: true });
    await writeFile(join(resources, PACKAGED_CATALOG_DIR, CATALOG_FILE), "{}", "utf8");
    const here = join(resources, "app.asar", "server", "dist", "lawoss");
    expect(bundledModelsCatalogPath({}, here)).toBe(join(resources, PACKAGED_CATALOG_DIR, CATALOG_FILE));
  });

  test("bez súboru engine použije svoj zabudovaný snapshot, ale stále nič nesťahuje", async () => {
    const empty = await tempDir("lawoss-no-catalog-");
    const env = lawossEngineEnv({}, join(empty, "a", "b", "c", "d"));
    expect(env.OPENCODE_MODELS_PATH).toBeUndefined();
    expect(env.OPENCODE_DISABLE_MODELS_FETCH).toBe("1");
  });

  test("vlastný katalóg cez premennú prostredia má prednosť", async () => {
    const dir = await tempDir("lawoss-own-catalog-");
    const own = join(dir, "firm.json");
    await writeFile(own, "{}", "utf8");
    expect(bundledModelsCatalogPath({ [LAWOSS_MODELS_CATALOG_ENV]: own })).toBe(own);
  });

  test.each([undefined, false])("spustený engine zachová poistky pri zdedenom aj prázdnom prostredí: %s", async inheritEnvironment => {
    const dir = await tempDir("lawoss-engine-env-");
    const envPath = join(dir, "engine-env.json");
    // Podvrhnutý engine: Node spustí súbor `serve` z pracovného priečinka, lebo engine
    // dostáva argumenty `serve --hostname … --port …`. Skript so shebangom Windows
    // nespustí (EFTYPE), takto test beží rovnako na Windows, Linuxe aj macOS.
    const node = Bun.which("node");
    if (!node) throw new Error("Test potrebuje Node.js v PATH.");
    await writeFile(join(dir, "serve"), `const fs = require("node:fs");
const http = require("node:http");
const keys = ["OPENCODE_MODELS_URL", "OPENCODE_MODELS_PATH", "OPENCODE_DISABLE_MODELS_FETCH", "OPENCODE_DISABLE_SHARE", "OPENCODE_DISABLE_AUTOUPDATE", "LAWOSS_SYNTHETIC_INHERIT_CANARY"];
fs.writeFileSync(${JSON.stringify(envPath)}, JSON.stringify(Object.fromEntries(keys.map((key) => [key, process.env[key] ?? null]))));
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
http.createServer((request, response) => {
  if (request.url === "/global/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ healthy: true, version: "engine-network-fixture" }));
  } else response.end("ok");
}).listen(port, "127.0.0.1", () => {
  process.stdout.write("opencode server listening on http://127.0.0.1:" + port + "\\n");
});
process.on("SIGTERM", () => process.exit(0));
`, "utf8");
    const ambientCatalog = join(dir, "ambient-firm-catalog.json");
    await writeFile(ambientCatalog, "{}", "utf8");
    const previousCatalog = process.env[LAWOSS_MODELS_CATALOG_ENV];
    const previousCanary = process.env.LAWOSS_SYNTHETIC_INHERIT_CANARY;
    let engine: Awaited<ReturnType<typeof createManagedOpencodeServer>> | undefined;
    try {
      process.env[LAWOSS_MODELS_CATALOG_ENV] = ambientCatalog;
      process.env.LAWOSS_SYNTHETIC_INHERIT_CANARY = "synthetic-parent";
      engine = await createManagedOpencodeServer({
        bin: node,
        cwd: dir,
        inheritEnvironment,
        env: { OPENCODE_MODELS_URL: "https://models.eigenweltlabs.com", OPENCODE_MODELS_PATH: "caller-must-not-override", OPENCODE_DISABLE_MODELS_FETCH: "0", OPENCODE_DISABLE_SHARE: "0", OPENCODE_DISABLE_AUTOUPDATE: "0" },
      });
      const seen = JSON.parse(await readFile(envPath, "utf8")) as Record<string, string | null>;
      expect(seen.OPENCODE_DISABLE_MODELS_FETCH).toBe("1");
      expect(seen.OPENCODE_DISABLE_SHARE).toBe("1");
      expect(seen.OPENCODE_DISABLE_AUTOUPDATE).toBe("1");
      expect(seen.OPENCODE_MODELS_PATH).toBe(inheritEnvironment === false ? bundledModelsCatalogPath({})! : ambientCatalog);
      expect(seen.LAWOSS_SYNTHETIC_INHERIT_CANARY).toBe(inheritEnvironment === false ? null : "synthetic-parent");
      expect(engine.execution.env.find((entry) => entry.name === "OPENCODE_DISABLE_MODELS_FETCH")?.value).toBe("1");
    } finally {
      try {await engine?.close();} finally {
        if (previousCatalog === undefined) delete process.env[LAWOSS_MODELS_CATALOG_ENV]; else process.env[LAWOSS_MODELS_CATALOG_ENV] = previousCatalog;
        if (previousCanary === undefined) delete process.env.LAWOSS_SYNTHETIC_INHERIT_CANARY; else process.env.LAWOSS_SYNTHETIC_INHERIT_CANARY = previousCanary;
      }
    }
  });
});
