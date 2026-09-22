import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { renderPreflight, runPreflight } from "./alpha-preflight.mjs";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createFixture(overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "lawoss-alpha-preflight-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, ".nvmrc"), overrides.nvmrc ?? "24\n");
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      overrides.packageJson ?? {
        packageManager: "pnpm@11.4.0",
        engines: { node: ">=24.0.0 <25.0.0" },
      },
    ),
  );
  if (overrides.buildGuide !== false) {
    await writeFile(path.join(root, "docs", "lawoss-build-pre-testerov.md"), "alpha build guide\n");
  }
  return root;
}

describe("LAWOSS alpha preflight", () => {
  test("accepts the supported runtime and required repository metadata", async () => {
    const root = await createFixture();
    const result = runPreflight({ root, nodeVersion: "v24.11.1", pnpmVersion: "11.4.0", strict: true });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test("warns in normal mode but fails in strict mode for an unsupported runtime", async () => {
    const root = await createFixture();
    const normal = runPreflight({ root, nodeVersion: "v26.0.0", pnpmVersion: "11.4.0" });
    const strict = runPreflight({ root, nodeVersion: "v26.0.0", pnpmVersion: "11.4.0", strict: true });

    expect(normal.ok).toBe(true);
    expect(normal.warnings.some((warning) => warning.includes("Node 24"))).toBe(true);
    expect(strict.ok).toBe(false);
    expect(strict.errors.some((error) => error.includes("Node 24"))).toBe(true);
  });

  test("does not call a warning-bearing normal run cleanly ready", async () => {
    const root = await createFixture();
    const result = runPreflight({ root, nodeVersion: "v26.0.0", pnpmVersion: "11.4.0" });
    const output = renderPreflight(result);

    expect(output).toContain("Result: READY WITH WARNINGS");
    expect(output).not.toContain("Result: READY FOR THE CHECKED SCOPE");
  });

  test("reports missing files and malformed package metadata without printing secrets", async () => {
    const root = await createFixture({
      buildGuide: false,
      nvmrc: "26\n",
      packageJson: { packageManager: "npm@10.0.0", engines: { node: ">=18" } },
    });
    const result = runPreflight({
      root,
      nodeVersion: "v26.0.0",
      pnpmVersion: "10.0.0",
      strict: true,
    });
    const output = renderPreflight(result);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("packageManager");
    expect(result.errors.join("\n")).toContain("build guide");
    expect(result.errors.join("\n")).toContain(".nvmrc");
    expect(output).not.toContain(process.env.OPENAI_API_KEY ?? "__missing__");
    expect(output).not.toContain(process.env.GITHUB_TOKEN ?? "__missing__");
  });
});
