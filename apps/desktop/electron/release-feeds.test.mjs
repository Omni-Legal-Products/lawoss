import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, createReleaseFeedResolver, releaseIdentity, selectReleaseFeed } from "./release-feeds.mjs";

export function release(tag, { prerelease = false, draft = false, platform = "win32", arch = "x64" } = {}) {
  const manifest = platform === "darwin" ? "latest-mac.yml" : platform === "linux" ? `latest-linux${arch === "arm64" ? "-arm64" : ""}.yml` : `latest${arch === "arm64" ? "-arm64" : ""}.yml`;
  const asset = platform === "darwin" ? `legalwork-mac-${arch}-1.zip` : platform === "linux" ? `legalwork-linux-${arch === "x64" ? "x86_64" : arch}-1.AppImage` : `legalwork-win-${arch}-1.exe`;
  return { id: tag, tag_name: tag, prerelease, draft, published_at: draft ? null : "2026-10-22T10:00:00Z", assets: [manifest, asset].map((name) => ({ name, state: "uploaded", size: 10 })) };
}
const select = (releases, channel) => selectReleaseFeed(releases, channel, "win32", "x64");

test("pre-release users advance from v3 pre-release to v4 regular release despite stale labels/order", () => {
  const releases = [release("v3.0.0", { prerelease: true }), release("v4.0.0")];
  for (const channel of ["stable", "prerelease", "alpha"]) assert.equal(select(releases, channel).version, "4.0.0");
});

test("v5 pre-release reaches only opted-in channels; manual promotion needs no rebuild", () => {
  const newer = release("v5.0.0", { prerelease: true });
  const releases = [newer, release("v4.0.0")];
  assert.equal(select(releases, "stable").version, "4.0.0");
  assert.equal(select(releases, "prerelease").version, "5.0.0");
  newer.prerelease = false;
  assert.equal(select(releases, "stable").releaseId, newer.id);
  assert.equal(select(releases, "stable").feedUrl, select(releases, "prerelease").feedUrl);
});

test("alphas and internal rolling tags never leak into Pre-release or Release", () => {
  const releases = [release("alpha-windows-x64-v5.0.0-alpha.22-abcdef1", { prerelease: true }), release("alpha-windows-latest", { prerelease: true }), release("v5.0.0-alpha.23", { prerelease: false }), release("v4.0.0")];
  assert.equal(select(releases, "prerelease").version, "4.0.0");
  assert.equal(select(releases, "stable").version, "4.0.0");
  assert.equal(select(releases, "alpha").version, "5.0.0-alpha.23");
});

test("numeric semver wins over API order, date, or a slower older alpha finishing last", () => {
  const releases = [release("v2.9.0"), release("v2.10.0"), release("v2.8.0")];
  assert.equal(select(releases, "stable").version, "2.10.0");
  const alphas = [release("alpha-windows-x64-v3.0.0-alpha.10-abcdef1"), release("alpha-windows-x64-v3.0.0-alpha.9-abcdef2")];
  assert.equal(select(alphas, "alpha").version, "3.0.0-alpha.10.gabcdef1");
  assert.equal(select([...alphas, release("v3.0.0")], "alpha").version, "3.0.0");
});

test("drafts, partial uploads, and the wrong architecture are excluded", () => {
  const partial = release("v7.0.0");
  partial.assets[1].state = "new";
  const noManifest = release("v8.0.0");
  noManifest.assets.shift();
  const releases = [release("v9.0.0", { draft: true }), partial, noManifest, release("v6.0.0", { arch: "arm64" }), release("v5.0.0")];
  assert.equal(select(releases, "alpha").version, "5.0.0");
  assert.equal(selectReleaseFeed(releases, "alpha", "win32", "arm64").version, "6.0.0");
  assert.equal(selectReleaseFeed(releases, "alpha", "darwin", "arm64"), null);
});

test("each supported platform resolves its own exact manifest and pinned release", () => {
  for (const platform of ["darwin", "win32", "linux"]) for (const arch of ["arm64", "x64"]) {
    const chosen = selectReleaseFeed([release("v3.0.0", { platform, arch, prerelease: true })], "prerelease", platform, arch);
    assert.equal(chosen.feedUrl, "https://github.com/eigenweltlabs/legalwork/releases/download/v3.0.0");
    assert.ok(chosen.assetNames.includes(chosen.manifest));
  }
});

test("invalid versions cannot bypass upgrade-only checks", () => {
  for (const version of ["1.2", "01.2.3", "garbage", "1.0.0-alpha.01"]) assert.equal(compareVersions(version, "1.0.0"), null);
  assert.equal(compareVersions("1.0.0-alpha.2", "1.0.0-alpha.10"), -1);
  assert.equal(compareVersions("v1.0.0", "1.0.0+build.2"), 0);
  assert.equal(releaseIdentity(release("alpha-windows-x64-v01.0.0-alpha.2-abcde")), null);
});

test("resolver paginates, shares a short cache, and observes manual label changes after expiry", async () => {
  let clock = 0, requests = 0, promoted = false;
  const resolve = createReleaseFeedResolver({ now: () => clock, fetchImpl: async (url) => {
    requests++;
    return new Response(JSON.stringify(url.includes("page=2") ? [release("v4.0.0")] : [release("v5.0.0", { prerelease: !promoted })]), { headers: url.includes("page=2") ? {} : { link: '<https://api.github.com/repositories/1278160330/releases?per_page=100&page=2>; rel="next"' } });
  } });
  assert.equal((await resolve("stable", "win32", "x64")).version, "4.0.0");
  assert.equal((await resolve("prerelease", "win32", "x64")).version, "5.0.0");
  assert.equal(requests, 2);
  promoted = true;
  clock = 61_000;
  assert.equal((await resolve("stable", "win32", "x64")).version, "5.0.0");
  assert.equal(requests, 4);
});

test("API failures never cache partial pagination or follow a different host", async () => {
  let requests = 0;
  const resolve = createReleaseFeedResolver({ fetchImpl: async () => {
    requests++;
    return new Response("[]", { headers: { link: '<https://attacker.invalid/releases?page=2>; rel="next"' } });
  } });
  await assert.rejects(resolve("stable"), /Invalid release pagination/);
  await assert.rejects(resolve("stable"), /Invalid release pagination/);
  assert.equal(requests, 2);
  const limited = createReleaseFeedResolver({ fetchImpl: async () => new Response("", { status: 403 }) });
  await assert.rejects(limited("prerelease"), /metadata unavailable \(403\)/);
});
