import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { checkOkfCliWithNode, onlyNodeOnPath } from "./lawoss-okf-cli-smoke.mjs";

// LAWOSS: tú istú kontrolu spúšťa check-packaged-security.mjs s pribaleným Node;
// tu beží s Node, ktorý spúšťa testy (na windows-2022 aj s cestou C:\...).
test("bundle OKF založia klienta, spis a pamäť len s Node v PATH", { timeout: 60_000 }, async () => {
  await checkOkfCliWithNode({ nodeDirectory: path.dirname(process.execPath) });
});

test("v PATH ostane len priečinok Node, aj keď Windows píše kľúč ako Path", () => {
  const env = onlyNodeOnPath({ Path: "C:\\Windows", PATH: "/usr/bin", path: "/bin", HOME: "/home/x", NODE_OPTIONS: "--inspect" }, "/opt/node");
  assert.deepEqual(env, { HOME: "/home/x", PATH: "/opt/node", NODE_OPTIONS: "", ELECTRON_RUN_AS_NODE: "" });
});

test("chýbajúci Node v PATH kontrolu zhodí", async () => {
  const empty = await mkdtemp(path.join(tmpdir(), "lawoss-okf-cli-no-node-"));
  try {
    await assert.rejects(checkOkfCliWithNode({ nodeDirectory: empty }), /ENOENT/);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test("Node, ktorý bundle nespustí, kontrolu zhodí", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lawoss-okf-cli-old-node-"));
  try {
    // Napodobní starý Node bez rozpoznania ESM: skončí chybou ako pri `import` v CommonJS.
    const fake = path.join(root, "node");
    await writeFile(fake, "#!/bin/sh\necho 'SyntaxError: Cannot use import statement outside a module' >&2\nexit 1\n");
    await chmod(fake, 0o755);
    await assert.rejects(checkOkfCliWithNode({ nodeDirectory: root }), /okf apply klient skončil s kódom 1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
