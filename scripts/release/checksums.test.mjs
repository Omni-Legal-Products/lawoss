import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChecksums, isElectronReleaseAsset, mergeChecksums } from "./checksums.mjs";

test("hashes release bytes and merges platform lists in filename order", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lawoss-checksums-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const mac = join(dir, "lawoss-mac-arm64-1.0.0.dmg");
  const win = join(dir, "lawoss-win-x64-1.0.0.exe");
  await writeFile(mac, "abc");
  await writeFile(win, "");
  const macList = join(dir, "mac-sums");
  const winList = join(dir, "win-sums");
  await writeFile(macList, await createChecksums([mac]));
  await writeFile(winList, await createChecksums([win]));
  assert.equal(await mergeChecksums([winList, macList]),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  lawoss-mac-arm64-1.0.0.dmg\n" +
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  lawoss-win-x64-1.0.0.exe\n");
  const original = await createChecksums([mac]);
  await writeFile(mac, "changed after signing");
  assert.notEqual(await createChecksums([mac]), original);
});

test("refuses missing, malformed and conflicting checksum artifacts", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lawoss-checksums-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(mergeChecksums([]), /Missing platform/);
  await assert.rejects(createChecksums([]), /No Electron release assets/);
  const first = join(dir, "first");
  const second = join(dir, "second");
  await writeFile(first, "");
  await assert.rejects(mergeChecksums([first]), /Empty checksum/);
  await writeFile(first, "not a checksum\n");
  await assert.rejects(mergeChecksums([first]), /Invalid checksum/);
  await writeFile(first, `${"a".repeat(64)}  lawoss-mac-arm64-1.0.0.zip\n`);
  await writeFile(second, `${"b".repeat(64)}  lawoss-mac-arm64-1.0.0.zip\n`);
  await assert.rejects(mergeChecksums([first, second]), /Conflicting checksums/);
});

test("release assets use the lawoss- artifactName prefix from electron-builder.yml", async (t) => {
  for (const name of [
    "lawoss-mac-arm64-0.2.1-lawoss.1.dmg",
    "lawoss-mac-x64-0.2.1-lawoss.1.zip.blockmap",
    "lawoss-win-x64-0.2.1-lawoss.1.exe",
    "lawoss-linux-x86_64-0.2.1-lawoss.1.AppImage",
    "lawoss-linux-x64-0.2.1-lawoss.1.tar.gz",
  ]) {
    assert.ok(isElectronReleaseAsset(name), name);
  }
  for (const name of ["legalwork-mac-arm64-0.2.1.dmg", "latest-mac.yml", "SHA256SUMS"]) {
    assert.equal(isElectronReleaseAsset(name), false, name);
  }
  const dir = await mkdtemp(join(tmpdir(), "lawoss-checksums-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const upstream = join(dir, "upstream-sums");
  await writeFile(upstream, `${"a".repeat(64)}  legalwork-mac-arm64-1.0.0.zip\n`);
  await assert.rejects(mergeChecksums([upstream]), /Invalid checksum/);
});
