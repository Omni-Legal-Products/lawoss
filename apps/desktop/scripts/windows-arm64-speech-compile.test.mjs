import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { compileCMakeJsAddon, ensureNodeDistribution, nodeDistributionDir } from "./windows-arm64-speech-compile.mjs";

function sha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("hlavičky Node sa stiahnu raz a cmake-js bez addonu zlyhá", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "lawoss-speech-"));
  try {
    const header = Buffer.from("headers");
    const lib = Buffer.from("lib");
    const sums = Buffer.from(`${sha(header)}  node-v24.21.0-headers.tar.gz\n${sha(lib)}  win-arm64/node.lib\n`);
    let fetches = 0;
    let extracted = 0;
    const fetchFile = async (url) => {
      fetches += 1;
      if (url.endsWith("/SHASUMS256.txt")) return sums;
      if (url.endsWith("/node-v24.21.0-headers.tar.gz")) return header;
      if (url.endsWith("/win-arm64/node.lib")) return lib;
      throw new Error(url);
    };
    const extractArchive = async (bytes, dir) => {
      extracted += 1;
      assert.equal(Buffer.compare(bytes, header), 0);
      const headerPath = path.join(dir, "include", "node");
      await mkdir(headerPath, { recursive: true });
      await writeFile(path.join(headerPath, "node.h"), "ok");
    };
    const first = await ensureNodeDistribution({ version: "24.21.0", arch: "arm64", home, fetchFile, extractArchive });
    assert.equal(first.downloaded, true);
    assert.equal(fetches, 3);
    assert.equal(extracted, 1);
    assert.equal(await readFile(path.join(nodeDistributionDir("24.21.0", "arm64", home), "win-arm64", "node.lib"), "utf8"), "lib");
    const second = await ensureNodeDistribution({ version: "24.21.0", arch: "arm64", home, fetchFile, extractArchive });
    assert.equal(second.downloaded, false);
    assert.equal(fetches, 3);

    let compiled = 0;
    await assert.rejects(
      compileCMakeJsAddon({ compile: async () => { compiled += 1; }, artifactExists: () => false, deadlineMs: 1_000 }),
      /was not produced/,
    );
    assert.equal(compiled, 1);
    await assert.rejects(
      compileCMakeJsAddon({ compile: () => new Promise(() => {}), artifactExists: () => true, deadlineMs: 20 }),
      /timed out/,
    );
    let alive = false;
    await compileCMakeJsAddon({
      compile: () => new Promise((resolve) => setTimeout(() => { alive = true; resolve(); }, 30)),
      artifactExists: () => alive,
      deadlineMs: 1_000,
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("pripravný skript nespúšťa cmake-js CLI", async () => {
  const source = await readFile(new URL("./prepare-windows-arm64-speech.mjs", import.meta.url), "utf8");
  assert.match(source, /compileCMakeJsAddon\(/);
  assert.match(source, /ensureNodeDistribution\(/);
  assert.match(source, /home:\s*homedir\(\)/);
  assert.doesNotMatch(source, /cmake-js\/bin\/cmake-js/);
});
