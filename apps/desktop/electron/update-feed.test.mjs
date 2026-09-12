import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import {
  FORK_RELEASE_DOWNLOAD_BASE_URL,
  RELEASE_ASSET_PREFIXES,
  releaseAssetName,
  resolveArchitectureDownloadUrl,
} from "./update-feed.mjs";

const PRIMARY_MANIFEST = "https://lawoss.app/update/latest-mac.yml";
const TAG_BASE = `${FORK_RELEASE_DOWNLOAD_BASE_URL}/v0.1.14`;

/**
 * Sledovaný feed odpovedá `primary` (404 = nenasadený); assety na GitHube
 * existujú len tie z `assets`. Každá požiadavka sa zapíše do `requests`.
 * @param {{ primary?: { status: number, body?: string }, assets?: string[] }} [options]
 */
function fakeFetch({ primary = { status: 404 }, assets = [] } = {}) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url, method: init.method ?? "GET" });
    if (url === PRIMARY_MANIFEST) {
      return { ok: primary.status === 200, status: primary.status, text: async () => primary.body ?? "" };
    }
    const found = assets.some((name) => url === `${TAG_BASE}/${name}`);
    return { ok: found, status: found ? 200 : 404, text: async () => "" };
  };
  return { fetch, requests };
}

const selectFirstUrl = (raw) => raw.match(/^\s*-\s+url:\s*(.+?)\s*$/m)?.[1] ?? null;

function resolve(platform, arch, feed, version = "0.1.14") {
  return resolveArchitectureDownloadUrl({
    manifestUrl: PRIMARY_MANIFEST,
    selectFromManifest: selectFirstUrl,
    platform,
    arch,
    version,
    fetch: feed.fetch,
  });
}

describe("releaseAssetName", () => {
  it("skladá názov podľa artifactName z electron-builder.yml", () => {
    const version = "0.1.14";
    assert.equal(releaseAssetName({ platform: "darwin", arch: "arm64", version }), "lawoss-mac-arm64-0.1.14.dmg");
    assert.equal(releaseAssetName({ platform: "darwin", arch: "x64", version }), "lawoss-mac-x64-0.1.14.dmg");
    assert.equal(releaseAssetName({ platform: "win32", arch: "x64", version }), "lawoss-win-x64-0.1.14.exe");
    assert.equal(releaseAssetName({ platform: "linux", arch: "arm64", version }), "lawoss-linux-arm64-0.1.14.AppImage");
  });

  it("x64 AppImage má v názve x86_64", () => {
    assert.equal(
      releaseAssetName({ platform: "linux", arch: "x64", version: "0.1.14" }),
      "lawoss-linux-x86_64-0.1.14.AppImage",
    );
  });

  it("pozná oba prefixy, preferovaný je lawoss-", () => {
    assert.deepEqual([...RELEASE_ASSET_PREFIXES], ["lawoss", "legalwork"]);
    assert.equal(
      releaseAssetName({ platform: "win32", arch: "x64", version: "0.1.14", prefix: "legalwork" }),
      "legalwork-win-x64-0.1.14.exe",
    );
  });
});

describe("resolveArchitectureDownloadUrl", () => {
  it("primárny 404 → fallback na tag v<verzia>, mac arm64 so starším prefixom legalwork-", async () => {
    const feed = fakeFetch({ assets: ["legalwork-mac-arm64-0.1.14.dmg"] });
    const url = await resolve("darwin", "arm64", feed);
    assert.equal(url, `${TAG_BASE}/legalwork-mac-arm64-0.1.14.dmg`);
    assert.deepEqual(feed.requests, [
      { url: PRIMARY_MANIFEST, method: "GET" },
      { url: `${TAG_BASE}/lawoss-mac-arm64-0.1.14.dmg`, method: "HEAD" },
      { url: `${TAG_BASE}/legalwork-mac-arm64-0.1.14.dmg`, method: "HEAD" },
    ]);
  });

  it("win x64 s novým prefixom lawoss- — starý prefix sa už neskúša", async () => {
    const feed = fakeFetch({ assets: ["lawoss-win-x64-0.1.14.exe", "legalwork-win-x64-0.1.14.exe"] });
    const url = await resolve("win32", "x64", feed);
    assert.equal(url, `${TAG_BASE}/lawoss-win-x64-0.1.14.exe`);
    assert.equal(feed.requests.length, 2);
    assert.ok(feed.requests.every((request) => !request.url.includes("legalwork-")));
  });

  it("linux x64 mieri na x86_64 AppImage", async () => {
    const feed = fakeFetch({ assets: ["legalwork-linux-x86_64-0.1.14.AppImage"] });
    const url = await resolve("linux", "x64", feed);
    assert.equal(url, `${TAG_BASE}/legalwork-linux-x86_64-0.1.14.AppImage`);
    assert.ok(feed.requests.every((request) => !request.url.includes("releases/latest")));
  });

  it("funkčný sledovaný feed má prednosť a GitHub sa nekontaktuje", async () => {
    const feed = fakeFetch({
      primary: { status: 200, body: "version: 0.1.14\nfiles:\n  - url: lawoss-mac-arm64-0.1.14.dmg\n" },
      assets: ["lawoss-mac-arm64-0.1.14.dmg"],
    });
    const url = await resolve("darwin", "arm64", feed);
    // Relatívny názov z manifestu sa rieši voči feedu, nie voči GitHubu.
    assert.equal(url, "https://lawoss.app/update/lawoss-mac-arm64-0.1.14.dmg");
    assert.equal(feed.requests.length, 1);
  });

  it("bez releasu sa vzdá potichu — null, nič nevyhodí, log najviac raz na beh", async () => {
    const info = mock.method(console, "info", () => {});
    try {
      const feed = fakeFetch();
      assert.equal(await resolve("darwin", "arm64", feed, "7.7.7"), null);
      // Prvý beh: najviac dve udalosti (feed nedostupný, žiadny release);
      // hlásenie o feede mohol už vypísať skorší test — log je raz na proces.
      const afterFirst = info.mock.callCount();
      assert.ok(afterFirst >= 1 && afterFirst <= 2, `neočakávaný počet logov: ${afterFirst}`);
      assert.match(String(info.mock.calls.at(-1)?.arguments[0]), /release v7\.7\.7 nemá inštalátor/);
      // Druhý beh s rovnakým výsledkom nepridá ani riadok.
      assert.equal(await resolve("darwin", "arm64", feed, "7.7.7"), null);
      assert.equal(info.mock.callCount(), afterFirst);
    } finally {
      info.mock.restore();
    }
  });

  it("výpadok siete (fetch vyhodí) končí null, nie výnimkou", async () => {
    const feed = {
      fetch: async () => {
        throw new Error("ENOTFOUND");
      },
    };
    assert.equal(await resolve("win32", "x64", feed, "8.8.8"), null);
  });
});
