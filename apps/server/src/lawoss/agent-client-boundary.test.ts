import { expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requireClientWorkspaceBoundary } from "./agent-client-boundary.js";
import { syntheticHostConfig } from "./test-support/host-config.js";

test("missing configured host scope is unknown, never an implicit client grant", async () => {
  const {root, config} = await syntheticHostConfig();
  try {
    const directory = join(root, "lawoss-onboarding"); await mkdir(directory);
    for (const key of ["officeRoot", "clientRoot"]) {
      await writeFile(join(directory, "profile.json"), JSON.stringify({[key]: join(root, "missing")}));
      await expect(requireClientWorkspaceBoundary(config, root)).rejects.toMatchObject({status: 403, code: "wiki_agent_client_scope_unknown"});
    }
  } finally {await rm(root, {recursive: true});}
});
