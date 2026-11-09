/**
 * LAWOSS: skutočný engine pri studenom štarte číta katalóg modelov len z
 * `lawossEngineEnv()` (engine-network.ts, rozhodnutie MČ 5. 10. 2026), nie z
 * katalógu ani zrkadla, ktoré mu podstrčí volajúci. Nahrádza upstream test
 * `model-catalog-engine.e2e.test.ts` (#230), ktorého relay LAWOSS nespúšťa.
 * Engine v2 (2.1.4) vypíše modely poskytovateľa až s prihlásením; syntetický
 * `ANTHROPIC_API_KEY` (premenná z katalógu) ho zapne bez siete a bez modelu.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { createManagedOpencodeServer } from "../managed-opencode.js";
import { LAWOSS_MODELS_CATALOG_ENV } from "./engine-network.js";

const engineBin = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const previousCatalog = process.env[LAWOSS_MODELS_CATALOG_ENV];
const temporary: string[] = [];

afterEach(async () => {
  if (previousCatalog === undefined) delete process.env[LAWOSS_MODELS_CATALOG_ENV];
  else process.env[LAWOSS_MODELS_CATALOG_ENV] = previousCatalog;
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function catalogWith(modelId: string) {
  return {
    anthropic: {
      id: "anthropic", name: "Anthropic", env: ["ANTHROPIC_API_KEY"], npm: "@ai-sdk/anthropic",
      models: {
        [modelId]: {
          id: modelId, name: modelId, release_date: "2026-11-02",
          attachment: false, reasoning: true, temperature: false, tool_call: true,
          limit: { context: 128000, output: 32000 },
        },
      },
    },
  };
}

test.skipIf(!engineBin)("studený engine vidí katalóg LAWOSS, katalóg ani zrkadlo volajúceho nepoužije", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawoss-engine-catalog-"));
  temporary.push(root);
  const lawossModel = "lawoss-catalog-probe";
  const callerModel = "caller-catalog-probe";

  const lawossCatalog = join(root, "lawoss-api.json");
  const callerCatalog = join(root, "caller-api.json");
  await writeFile(lawossCatalog, JSON.stringify(catalogWith(lawossModel)));
  await writeFile(callerCatalog, JSON.stringify(catalogWith(callerModel)));
  process.env[LAWOSS_MODELS_CATALOG_ENV] = lawossCatalog;

  let mirrorRequests = 0;
  const mirror = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    mirrorRequests += 1;
    return Response.json(catalogWith(callerModel));
  } });
  const configPath = join(root, "opencode.json");
  await writeFile(configPath, "{}");

  let engine: Awaited<ReturnType<typeof createManagedOpencodeServer>> | undefined;
  try {
    engine = await createManagedOpencodeServer({
      bin: engineBin, cwd: root,
      env: {
        HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"),
        XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
        OPENCODE_CONFIG: configPath, OPENCODE_DB: join(root, "engine.db"),
        // Ako upstream relay (#230): volajúci ponúkne vlastné zrkadlo aj súbor.
        OPENCODE_MODELS_URL: `http://127.0.0.1:${mirror.port}`, OPENCODE_MODELS_PATH: callerCatalog,
        // Syntetický kľúč: poskytovateľ z katalógu sa vo v2 vypíše až s prihlásením (nič sa nevolá).
        ANTHROPIC_API_KEY: "synthetic-catalog-key",
      },
    });
    const response = await fetch(`${engine.url}/api/model?${new URLSearchParams({ "location[directory]": root })}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}` },
      signal: AbortSignal.timeout(10000),
    });
    expect(response.status).toBe(200);
    const models = z.object({
      data: z.array(z.object({ id: z.string(), providerID: z.string() }).passthrough()),
    }).parse(await response.json()).data.filter((model) => model.providerID === "anthropic").map((model) => model.id);
    expect(models).toContain(lawossModel);
    expect(models).not.toContain(callerModel);
    expect(mirrorRequests).toBe(0);
  } finally {
    await engine?.close();
    mirror.stop(true);
  }
}, 30000);
