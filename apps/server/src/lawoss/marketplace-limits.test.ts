import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { resolveClaudePluginBundle } from "../claude-plugin-bundle.js";
import { BUNDLED_MARKETPLACE_PLUGINS, BUNDLED_MARKETPLACE_REF } from "./marketplace-bundled-ref.js";
import { downloadPluginResources, isTrustedMarketplaceSource, pluginResourceLimits, trustedReleaseRefs } from "./marketplace-limits.js";

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
/** Strom vráti `size` blobov (ako GitHub), keď je zapnuté; bez neho ostáva len stráž počas sťahovania. */
let treeSizes = false;
const rawRequests: string[] = [];
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
        return files
          ? Response.json({ tree: Object.entries(files).map(([path, content]) => ({ path, sha: `blob-${path}`, type: "blob", ...(treeSizes ? { size: Buffer.byteLength(content) } : {}) })) })
          : new Response("{}", { status: 404 });
      }
      if (parts[1] === "raw") {
        rawRequests.push(parts.slice(5).join("/"));
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

async function rejection(url: string, trustedRefs?: string[]): Promise<{ code?: string; message: string } | null> {
  try {
    await resolveClaudePluginBundle({ url, trustedRefs });
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
  test("verí len commitu pribaleného katalógu a SHA vydania z vlastnej kontroly, s koreňom plugins/<názov>/", () => {
    const marketplace = { owner: "Omni-Legal-Products", repo: "lawoss-marketplace" };
    const bundled = BUNDLED_MARKETPLACE_REF;
    expect(isTrustedMarketplaceSource(marketplace, bundled, "plugins/demo/")).toBe(true);
    expect(isTrustedMarketplaceSource(marketplace, SHA, "plugins/demo/", [SHA])).toBe(true);
    // Iný 40-hex commit toho istého repozitára (napríklad commit len vo forku) nestačí.
    expect(isTrustedMarketplaceSource(marketplace, SHA, "plugins/demo/")).toBe(false);
    expect(isTrustedMarketplaceSource(marketplace, "main", "plugins/demo/", ["main"])).toBe(false);
    expect(isTrustedMarketplaceSource(marketplace, "A".repeat(40), "plugins/demo/", ["A".repeat(40)])).toBe(false);
    expect(isTrustedMarketplaceSource(marketplace, bundled, "")).toBe(false);
    expect(isTrustedMarketplaceSource(marketplace, bundled, "other/demo/")).toBe(false);
    expect(isTrustedMarketplaceSource({ owner: "someone", repo: "lawoss-marketplace" }, bundled, "plugins/demo/", [bundled])).toBe(false);
    expect(isTrustedMarketplaceSource({ owner: "Omni-Legal-Products", repo: "lawoss-marketplace-fork" }, bundled, "plugins/demo/")).toBe(false);
    expect(pluginResourceLimits({ owner: "x", repo: "y" }, bundled, "plugins/demo/")).toEqual({ fileBytes: MIB, totalBytes: 8 * MIB });
    expect(pluginResourceLimits(marketplace, SHA, "plugins/demo/")).toEqual({ fileBytes: MIB, totalBytes: 8 * MIB });
    expect(pluginResourceLimits(marketplace, bundled, "plugins/demo/")).toEqual({ fileBytes: 8 * MIB, totalBytes: 24 * MIB });
  });

  test("SHA vydania berie len z úspešnej kontroly a len ako 40-hex commit", () => {
    const release = (sha: string) => ({ lastCheck: { status: "ok" as const, release: { tag: "v1.0.0", sha, publishedAt: null, source: "release" as const, plugins: [] } } });
    expect(trustedReleaseRefs(release(SHA))).toEqual([SHA]);
    expect(trustedReleaseRefs(release("main"))).toEqual([]);
    expect(trustedReleaseRefs({ lastCheck: { status: "error", message: "x" } })).toEqual([]);
    expect(trustedReleaseRefs({ lastCheck: null })).toEqual([]);
  });

  test("pribalený katalóg appky a serverová konštanta majú rovnaký commit", async () => {
    const snapshot: unknown = await Bun.file(new URL("../../../app/src/lawoss/domains/marketplace/marketplace-snapshot.json", import.meta.url)).json();
    expect(snapshot).toMatchObject({ ref: BUNDLED_MARKETPLACE_REF });
  });

  test("#510: serverový zoznam verzií zodpovedá pluginom pribaleného katalógu na jeho commite", async () => {
    const snapshot: { ref: string; plugins: Array<{ name: string; version: string; path: string; ref: string | null }> } =
      await Bun.file(new URL("../../../app/src/lawoss/domains/marketplace/marketplace-snapshot.json", import.meta.url)).json();
    const pinned = snapshot.plugins.filter((plugin) => plugin.ref === snapshot.ref).map(({ name, version, path }) => ({ name, version, path }));
    expect(BUNDLED_MARKETPLACE_PLUGINS).toEqual(pinned);
  });

  test("všeobecný import z GitHubu ostáva pri 1 MiB na súbor a 8 MiB spolu", async () => {
    expect(await rejection(publish(OTHER, SHA, plugin({ "index.js": 1.5 * MIB })))).toMatchObject({ code: "unsupported_plugin_resources", message: "Plugin resource is binary or exceeds 1 MiB" });
    const nine = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`part${index}.js`, MIB - 1024]));
    expect(await rejection(publish(OTHER, SHA, plugin(nine)))).toMatchObject({ code: "unsupported_plugin_resources", message: "Plugin resources exceed 8 MiB" });
    // Správny repozitár, ale nepripnutá vetva: tiež pôvodné limity.
    expect(await rejection(publish(MARKETPLACE, "main", plugin({ "index.js": 1.5 * MIB })))).toMatchObject({ message: "Plugin resource is binary or exceeds 1 MiB" });
    // Správny repozitár, 40-hex commit, ktorému appka neverí (ani katalóg, ani vydanie): pôvodné limity.
    expect(await rejection(publish(MARKETPLACE, "8".repeat(40), plugin({ "index.js": 1.5 * MIB })))).toMatchObject({ message: "Plugin resource is binary or exceeds 1 MiB" });
    expect(await rejection(publish(MARKETPLACE, "8".repeat(40), plugin({ "index.js": 1.5 * MIB })), ["9".repeat(40)])).toMatchObject({ message: "Plugin resource is binary or exceeds 1 MiB" });
    const small = await resolveClaudePluginBundle({ url: publish(OTHER, SHA, plugin({ "index.js": MIB - 1024 })) });
    expect(resourceBytes(small, "dist/index.js")).toBe(MIB - 1024);
  });

  test("LAWOSS Marketplace na commite pribaleného katalógu prijme 6 MiB súbor a 9 MiB spolu", async () => {
    const bundle = await resolveClaudePluginBundle({ url: publish(MARKETPLACE, BUNDLED_MARKETPLACE_REF, plugin({ "index.js": 6 * MIB, "pdf.worker.mjs": 3 * MIB })) });
    expect(resourceBytes(bundle, "dist/index.js")).toBe(6 * MIB);
    expect(resourceBytes(bundle, "dist/pdf.worker.mjs")).toBe(3 * MIB);
  });

  test("LAWOSS Marketplace na SHA vydania z kontroly aktualizácií prijme 6 MiB súbor", async () => {
    const release = "a".repeat(40);
    const bundle = await resolveClaudePluginBundle({ url: publish(MARKETPLACE, release, plugin({ "index.js": 6 * MIB })), trustedRefs: [release] });
    expect(resourceBytes(bundle, "dist/index.js")).toBe(6 * MIB);
  });

  test("veľkosti zo stromu odmietnu súbor aj súčet nad limitom bez jediného stiahnutia", async () => {
    treeSizes = true;
    try {
      rawRequests.length = 0;
      expect(await rejection(publish(OTHER, SHA, plugin({ "index.js": 1.5 * MIB })))).toMatchObject({ code: "unsupported_plugin_resources", message: "Plugin resource is binary or exceeds 1 MiB" });
      const nine = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`part${index}.js`, MIB - 1024]));
      expect(await rejection(publish(OTHER, "b".repeat(40), plugin(nine)))).toMatchObject({ code: "unsupported_plugin_resources", message: "Plugin resources exceed 8 MiB" });
      const total = { "a.js": 6.25 * MIB, "b.js": 6.25 * MIB, "c.js": 6.25 * MIB, "d.js": 6.25 * MIB };
      expect(await rejection(publish(MARKETPLACE, "c".repeat(40), plugin(total)), ["c".repeat(40)])).toMatchObject({ message: "Plugin resources exceed 24 MiB" });
      expect(rawRequests).toEqual([]);
    } finally {
      treeSizes = false;
    }
  });

  test("prvé prekročenie súčtu počas sťahovania zastaví ostatné sťahovania", async () => {
    // Strom bez veľkostí: rozhoduje spoločné počítadlo. 20 × 0,9 MiB > 8 MiB.
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`part${String(index).padStart(2, "0")}.js`, 0.9 * MIB]));
    rawRequests.length = 0;
    expect(await rejection(publish(OTHER, "d".repeat(40), plugin(many)))).toMatchObject({ code: "unsupported_plugin_resources", message: "Plugin resources exceed 8 MiB" });
    const parts = () => rawRequests.filter((path) => path.includes("/dist/part")).length;
    // Zrušené požiadavky môžu na server doraziť o chvíľu neskôr; nové sa po odmietnutí nezačnú.
    await Bun.sleep(100);
    const started = parts();
    // Najviac 8 celých súborov + 6 rozbehnutých sťahovaní; zvyšných 6 sa nezačne.
    expect(started).toBeLessThanOrEqual(14);
    await Bun.sleep(200);
    expect(parts()).toBe(started);
  });

  test("LAWOSS Marketplace odmietne 9 MiB súbor, 25 MiB spolu a binárny súbor", async () => {
    const trusted = ["4", "5", "6", "7"].map((digit) => digit.repeat(40));
    expect(await rejection(publish(MARKETPLACE, "4".repeat(40), plugin({ "index.js": 9 * MIB })), trusted)).toMatchObject({ code: "unsupported_plugin_resources", message: "Plugin resource is binary or exceeds 8 MiB" });
    const total = { "a.js": 6.25 * MIB, "b.js": 6.25 * MIB, "c.js": 6.25 * MIB, "d.js": 6.25 * MIB };
    expect(await rejection(publish(MARKETPLACE, "5".repeat(40), plugin(total)), trusted)).toMatchObject({ code: "unsupported_plugin_resources", message: "Plugin resources exceed 24 MiB" });
    expect(await rejection(publish(MARKETPLACE, "6".repeat(40), plugin({ "index.js": "export const x = 1;\0\n" })), trusted)).toMatchObject({ code: "unsupported_plugin_resources", message: "Plugin resource is binary or exceeds 8 MiB" });
    // Zoznam povolených mien sa nemení ani pre dôveryhodný zdroj.
    expect(await rejection(publish(MARKETPLACE, "7".repeat(40), plugin({ "addon.node": "x" })), trusted)).toMatchObject({ code: "unsupported_plugin_resources", message: "Node plugin contains unsupported resources or exceeds 128 files" });
  });

  test("prvé porušenie zruší rozbehnuté sťahovania, nespustí ďalšie a vráti chybu limitu, nie dôvod zrušenia", async () => {
    const limits = { fileBytes: MIB, totalBytes: 8 * MIB };
    const entries = Array.from({ length: 10 }, (_, index) => ({ path: `f${index}`, size: null }));
    const called: string[] = [];
    const aborted: string[] = [];
    let release: () => void = () => undefined;
    const hungStarted = new Promise<void>((resolve) => { let count = 0; release = () => { if (++count === 5) resolve(); }; });
    const failure = await downloadPluginResources(entries, limits, async (entry, { signal }) => {
      called.push(entry.path);
      if (entry.path === "f5") {
        await hungStarted;
        return "x".repeat(MIB + 1);
      }
      release();
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => { aborted.push(entry.path); reject(new DOMException("aborted", "AbortError")); }, { once: true });
      });
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "unsupported_plugin_resources", message: "Plugin resource is binary or exceeds 1 MiB" });
    expect(called.sort()).toEqual(["f0", "f1", "f2", "f3", "f4", "f5"]);
    expect(aborted.sort()).toEqual(["f0", "f1", "f2", "f3", "f4"]);
  });
});
