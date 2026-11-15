import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { resolveClaudePluginBundle } from "../claude-plugin-bundle.js";
import { isPinnedMarketplaceSource, pluginResourceLimits } from "./marketplace-limits.js";

const MIB = 1024 * 1024;
const SHA = "3".repeat(40);
const MARKETPLACE = "Omni-Legal-Products/lawoss-marketplace";
const OTHER = "someone/lawoss-marketplace";

/** Vymyslený Node doplnok so zbaleným runtime `dist/*.js` zadanej veľkosti (ASCII, 1 bajt na znak). */
function plugin(dist: Record<string, number | string>): Record<string, string> {
  const files: Record<string, string> = {
    "plugins/demo/.claude-plugin/plugin.json": JSON.stringify({ name: "demo", version: "1.0.0" }),
    "plugins/demo/.mcp.json": JSON.stringify({ mcpServers: { demo: { command: "node", args: ["scripts/run.mjs", "mcp"] } } }),
    "plugins/demo/runtime-config.json": JSON.stringify({ name: "demo", entrypoint: "dist/index.js" }),
    "plugins/demo/scripts/run.mjs": "// run\n",
  };
  for (const [name, size] of Object.entries(dist)) files[`plugins/demo/dist/${name}`] = typeof size === "string" ? size : `//${"x".repeat(size - 2)}`;
  return files;
}

// repo -> ref -> files
const repos = new Map<string, Map<string, Record<string, string>>>();
let server: ReturnType<typeof Bun.serve>;
const saved: Record<string, string | undefined> = {};

function publish(repo: string, ref: string, files: Record<string, string>): string {
  if (!repos.has(repo)) repos.set(repo, new Map());
  repos.get(repo)!.set(ref, files);
  return `https://github.com/${repo}/tree/${ref}/plugins/demo`;
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const parts = new URL(request.url).pathname.split("/").map(decodeURIComponent);
      if (parts[1] === "api" && parts[2] === "repos" && parts[5] === "git" && parts[6] === "trees") {
        const files = repos.get(`${parts[3]}/${parts[4]}`)?.get(parts[7] ?? "");
        return files ? Response.json({ tree: Object.keys(files).map((path) => ({ path, sha: `blob-${path}`, type: "blob" })) }) : new Response("{}", { status: 404 });
      }
      if (parts[1] === "raw") {
        const content = repos.get(`${parts[2]}/${parts[3]}`)?.get(parts[4] ?? "")?.[parts.slice(5).join("/")];
        return content === undefined ? new Response("missing", { status: 404 }) : new Response(content);
      }
      return new Response("unexpected", { status: 418 });
    },
  });
  for (const key of ["LEGALWORK_GITHUB_API_BASE", "LEGALWORK_GITHUB_RAW_BASE"]) saved[key] = process.env[key];
  process.env.LEGALWORK_GITHUB_API_BASE = `http://127.0.0.1:${server.port}/api`;
  process.env.LEGALWORK_GITHUB_RAW_BASE = `http://127.0.0.1:${server.port}/raw`;
});

afterAll(async () => {
  await server.stop(true);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function rejection(url: string): Promise<{ code?: string; message: string } | null> {
  try {
    await resolveClaudePluginBundle({ url });
    return null;
  } catch (error) {
    return error as { code?: string; message: string };
  }
}

function resourceBytes(bundle: Awaited<ReturnType<typeof resolveClaudePluginBundle>>, title: string): number {
  const object = bundle.resolved.memberships.find((membership) => membership.configObject?.objectType === "resource" && membership.configObject.title === title)?.configObject;
  return object?.latestVersion?.rawSourceText?.length ?? -1;
}

describe("LAWOSS #420: limity prostriedkov Node doplnku podľa zdroja", () => {
  test("rozpozná len LAWOSS Marketplace na pripnutom commite s koreňom plugins/<názov>/", () => {
    const marketplace = { owner: "Omni-Legal-Products", repo: "lawoss-marketplace" };
    expect(isPinnedMarketplaceSource(marketplace, SHA, "plugins/demo/")).toBe(true);
    expect(isPinnedMarketplaceSource(marketplace, "main", "plugins/demo/")).toBe(false);
    expect(isPinnedMarketplaceSource(marketplace, "A".repeat(40), "plugins/demo/")).toBe(false);
    expect(isPinnedMarketplaceSource(marketplace, SHA, "")).toBe(false);
    expect(isPinnedMarketplaceSource(marketplace, SHA, "other/demo/")).toBe(false);
    expect(isPinnedMarketplaceSource({ owner: "someone", repo: "lawoss-marketplace" }, SHA, "plugins/demo/")).toBe(false);
    expect(isPinnedMarketplaceSource({ owner: "Omni-Legal-Products", repo: "lawoss-marketplace-fork" }, SHA, "plugins/demo/")).toBe(false);
    expect(pluginResourceLimits({ owner: "x", repo: "y" }, SHA, "plugins/demo/")).toEqual({ fileBytes: MIB, totalBytes: 8 * MIB });
    expect(pluginResourceLimits(marketplace, SHA, "plugins/demo/")).toEqual({ fileBytes: 8 * MIB, totalBytes: 24 * MIB });
  });

  test("všeobecný import z GitHubu ostáva pri 1 MiB na súbor a 8 MiB spolu", async () => {
    expect(await rejection(publish(OTHER, SHA, plugin({ "index.js": 1.5 * MIB })))).toMatchObject({ code: "unsupported_plugin_resources", message: "Plugin resource is binary or exceeds 1 MiB" });
    const nine = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`part${index}.js`, MIB - 1024]));
    expect(await rejection(publish(OTHER, SHA, plugin(nine)))).toMatchObject({ code: "unsupported_plugin_resources", message: "Plugin resources exceed 8 MiB" });
    // Správny repozitár, ale nepripnutá vetva: tiež pôvodné limity.
    expect(await rejection(publish(MARKETPLACE, "main", plugin({ "index.js": 1.5 * MIB })))).toMatchObject({ message: "Plugin resource is binary or exceeds 1 MiB" });
    const small = await resolveClaudePluginBundle({ url: publish(OTHER, SHA, plugin({ "index.js": MIB - 1024 })) });
    expect(resourceBytes(small, "dist/index.js")).toBe(MIB - 1024);
  });

  test("LAWOSS Marketplace prijme 6 MiB súbor a 9 MiB spolu", async () => {
    const bundle = await resolveClaudePluginBundle({ url: publish(MARKETPLACE, SHA, plugin({ "index.js": 6 * MIB, "pdf.worker.mjs": 3 * MIB })) });
    expect(resourceBytes(bundle, "dist/index.js")).toBe(6 * MIB);
    expect(resourceBytes(bundle, "dist/pdf.worker.mjs")).toBe(3 * MIB);
  });

  test("LAWOSS Marketplace odmietne 9 MiB súbor, 25 MiB spolu a binárny súbor", async () => {
    expect(await rejection(publish(MARKETPLACE, "4".repeat(40), plugin({ "index.js": 9 * MIB })))).toMatchObject({ code: "unsupported_plugin_resources", message: "Plugin resource is binary or exceeds 8 MiB" });
    const total = { "a.js": 6.25 * MIB, "b.js": 6.25 * MIB, "c.js": 6.25 * MIB, "d.js": 6.25 * MIB };
    expect(await rejection(publish(MARKETPLACE, "5".repeat(40), plugin(total)))).toMatchObject({ code: "unsupported_plugin_resources", message: "Plugin resources exceed 24 MiB" });
    expect(await rejection(publish(MARKETPLACE, "6".repeat(40), plugin({ "index.js": "export const x = 1;\0\n" })))).toMatchObject({ code: "unsupported_plugin_resources", message: "Plugin resource is binary or exceeds 8 MiB" });
    // Zoznam povolených mien sa nemení ani pre dôveryhodný zdroj.
    expect(await rejection(publish(MARKETPLACE, "7".repeat(40), plugin({ "addon.node": "x" })))).toMatchObject({ code: "unsupported_plugin_resources", message: "Node plugin contains unsupported resources or exceeds 128 files" });
  });
});
