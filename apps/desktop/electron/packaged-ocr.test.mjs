import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const { pruneOcrRuntime } = require("../scripts/packaged-ocr.cjs");
const { Arch } = require("electron-builder");
const { parse } = require("yaml");

test("packaged OCR retains only its target runtime and fails if required payload is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ocr-package-"));
  try {
    for (const platform of ["darwin", "win32", "linux"]) for (const arch of ["arm64", "x64"]) {
      const resources = path.join(root, platform, arch), modules = path.join(resources, "app.asar.unpacked/node_modules");
      for (const name of ["onnxruntime-node", "onnxruntime-common", "@napi-rs/canvas", "paddleocr", "image-size"]) {
        const dir = path.join(modules, name); await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, "package.json"), JSON.stringify({ name, main: "index.js" }));
        await writeFile(path.join(dir, "index.js"), "");
      }
      const bin = path.join(modules, "onnxruntime-node/bin/napi-v6");
      for (const os of ["darwin", "win32", "linux"]) for (const cpu of ["arm64", "x64"]) {
        await mkdir(path.join(bin, os, cpu), { recursive: true });
        await writeFile(path.join(bin, os, cpu, "onnxruntime_binding.node"), "fixture");
      }
      await mkdir(path.join(resources, "ocr")); await writeFile(path.join(resources, "ocr/native-worker.cjs"), "");
      await writeFile(path.join(resources, "ocr/layout-worker.cjs"), "");
      pruneOcrRuntime(resources, platform, arch);
      assert.deepEqual(await readdir(bin), [platform]);
      assert.deepEqual(await readdir(path.join(bin, platform)), [arch]);
      assert.throws(() => pruneOcrRuntime(resources, platform, "missing"), /Missing OCR runtime/);
      await rm(path.join(resources, "ocr/layout-worker.cjs"));
      assert.throws(() => pruneOcrRuntime(resources, platform, arch), /Missing bundled layout worker/);
      await writeFile(path.join(resources, "ocr/layout-worker.cjs"), "");
      await rm(path.join(resources, "ocr/native-worker.cjs"));
      assert.throws(() => pruneOcrRuntime(resources, platform, arch), /Missing bundled OCR worker/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Run the real hook against an isolated package filesystem. OCR payload pruning
// is covered above; signing must be observed without invoking a host tool.
async function sidecarFixture(t, platform, arch) {
  const root = await mkdtemp(path.join(tmpdir(), "sidecar-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const platformKey = { darwin: "mac", linux: "linux", win32: "win" }[platform];
  const cpu = arch === "arm64" ? "aarch64" : "x86_64";
  const os = { darwin: "apple-darwin", linux: "unknown-linux-gnu", win32: "pc-windows-msvc" }[platform];
  const triple = `${cpu}-${os}`;
  const suffix = platform === "win32" ? ".exe" : "";
  const resources = platform === "darwin"
    ? path.join(root, "LAWOSS.app", "Contents", "Resources")
    : path.join(root, "resources");
  const sidecars = path.join(resources, "sidecars");
  await mkdir(sidecars, { recursive: true });
  await mkdir(path.join(resources, "node"));
  await writeFile(path.join(resources, "node", `node${suffix}`), "node fixture");
  await mkdir(path.join(resources, "helpers", "LegalWork Computer Use.app"), { recursive: true });
  const config = parse(await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8"));
  const filter = config[platformKey].extraResources.find((entry) => entry.to === "sidecars").filter;
  const expected = [];
  for (const base of ["opencode", "legalwork-orchestrator", "versions.json"]) {
    const target = `${base}-${triple}${suffix}`;
    const alias = base === "versions.json" ? base : `${base}${suffix}`;
    assert.ok(filter.includes(target), `packaging config must include ${target}`);
    await writeFile(path.join(sidecars, target), `target contents: ${target}`);
    await writeFile(path.join(sidecars, alias), "stale alias");
    expected.push(alias, target);
  }
  await writeFile(path.join(sidecars, "obsolete-sidecar"), "must be pruned");
  const signed = [];
  const pruned = [];
  const module = { exports: {} };
  vm.runInNewContext(await readFile(new URL("../scripts/electron-after-pack.cjs", import.meta.url), "utf8"), {
    module,
    process: { env: {} },
    require(name) {
      if (name === "node:fs") return fs;
      if (name === "node:path") return path;
      if (name === "electron-builder") return { Arch };
      if (name === "./packaged-ocr.cjs") return { pruneOcrRuntime: (...args) => pruned.push(args) };
      if (name === "node:child_process") return { spawnSync: (...args) => { signed.push(args); return { status: 0 }; } };
      throw new Error(`Unexpected hook dependency: ${name}`);
    },
  });
  const afterPack = module.exports;
  assert.ok(typeof afterPack === "function", "afterPack must export a callable hook");
  return {
    run: (contextArch) => afterPack({
      appOutDir: root, electronPlatformName: platform, arch: contextArch,
      packager: { appInfo: { productFilename: "LAWOSS" } },
    }),
    resources, sidecars, expected, signed, pruned, triple, suffix,
  };
}

for (const platform of ["darwin", "linux", "win32"]) for (const arch of ["arm64", "x64"]) {
  for (const archForm of ["numeric", "string"]) {
    test(`afterPack finalizes configured sidecars for ${platform}/${arch} (${archForm} arch)`, async (t) => {
      const fixture = await sidecarFixture(t, platform, arch);
      await fixture.run(archForm === "numeric" ? Arch[arch] : arch);
      assert.deepEqual(fixture.pruned, [[fixture.resources, platform, arch]]);
      assert.deepEqual((await readdir(fixture.sidecars)).sort(), fixture.expected.sort());
      for (const base of ["opencode", "legalwork-orchestrator", "versions.json"]) {
        const alias = base === "versions.json" ? base : `${base}${fixture.suffix}`;
        assert.equal(await readFile(path.join(fixture.sidecars, alias), "utf8"),
          `target contents: ${base}-${fixture.triple}${fixture.suffix}`);
      }
      assert.equal(fixture.signed.length, platform === "darwin" ? 1 : 0);
      if (platform === "darwin") {
        assert.equal(fixture.signed[0][0], "codesign");
        assert.equal(fixture.signed[0][1].at(-1), path.join(fixture.resources, "helpers", "LegalWork Computer Use.app"));
      }
    });
  }
  test(`afterPack rejects a missing required sidecar for ${platform}/${arch}`, async (t) => {
    const fixture = await sidecarFixture(t, platform, arch);
    await rm(path.join(fixture.sidecars, `legalwork-orchestrator-${fixture.triple}${fixture.suffix}`));
    await assert.rejects(fixture.run(Arch[arch]), /Missing packaged sidecar for target: legalwork-orchestrator-/);
    assert.equal(fixture.signed.length, 0);
  });
}
