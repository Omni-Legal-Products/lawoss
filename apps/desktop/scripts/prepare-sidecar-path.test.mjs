import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./prepare-sidecar.mjs", import.meta.url), "utf8");

test("orchestrator build does not route argument arrays through a shell", () => {
  const orchestratorBlock = source.match(/spawnSync\("bun",[\s\S]*?\n  \}\);/u)?.[0];

  assert.ok(orchestratorBlock, "orchestrator spawn block should exist");
  assert.doesNotMatch(orchestratorBlock, /shell:\s*true/u);
});
