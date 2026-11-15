import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer, type ViteDevServer } from "vite";

const appRoot = resolve(import.meta.dir, "..");
const buildOutputs = ["dist", "dist-word-addin", "dist-design-system", "dist-docx-performance", "docx-qa"];
const probeName = `lawoss-watch-probe-${process.pid}`;
const created: string[] = [];
let server: ViteDevServer;

beforeAll(async () => {
  server = await createServer({
    configFile: join(appRoot, "vite.config.ts"),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
  });
}, 30_000);

afterAll(async () => {
  await server?.close();
  for (const path of created) rmSync(path, { recursive: true, force: true });
});

test("#455: dev server ignores changes in apps/app build outputs", async () => {
  const seen = new Set<string>();
  server.watcher.on("all", (_event, path) => seen.add(resolve(path)));

  const ignored = buildOutputs.map((dir) => {
    const probeDir = join(appRoot, dir, probeName);
    mkdirSync(probeDir, { recursive: true });
    created.push(probeDir);
    const file = join(probeDir, "tsconfig.json");
    writeFileSync(file, "{}");
    return file;
  });
  const control = join(appRoot, `.${probeName}.txt`);
  created.push(control);
  writeFileSync(control, "probe");

  const deadline = Date.now() + 15_000;
  while (!seen.has(control) && Date.now() < deadline) {
    await Bun.sleep(200);
    writeFileSync(control, `probe ${Date.now()}`);
  }
  await Bun.sleep(1_000);

  expect(seen.has(control)).toBe(true);
  expect(ignored.filter((file) => seen.has(file))).toEqual([]);
}, 30_000);
