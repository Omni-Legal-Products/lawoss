import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import {
  FORK_RELEASE_DOWNLOAD_BASE_URL,
  GITHUB_APP_RELEASES_API_URL,
  RELEASE_ASSET_PREFIXES,
  releaseAssetName,
  resolveGitHubAppFeed,
  resolveArchitectureDownloadUrl,
  selectAppRelease,
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

function githubRelease(tag, assetNames, options = {}) {
  return {
    tag_name: tag,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? false,
    assets: assetNames.map((name) => ({
      name,
      browser_download_url: `https://untrusted.invalid/${name}`,
    })),
  };
}

/** @param {unknown} body @param {{ status?: number, headers?: Record<string, string> }} [options] */
function jsonResponse(body, options = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: options.status === undefined || (options.status >= 200 && options.status < 300),
    status: options.status ?? 200,
    headers: { get: (name) => options.headers?.[name.toLowerCase()] ?? null },
    text: async () => raw,
  };
}

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

describe("selectAppRelease", () => {
  it("vyžaduje manifest aj inštalátor pre každú podporovanú platformu a architektúru", () => {
    const releases = [githubRelease("v2.0.0", [
      "latest-mac.yml",
      "lawoss-mac-arm64-2.0.0.dmg",
      "lawoss-mac-x64-2.0.0.dmg",
      "latest.yml",
      "lawoss-win-x64-2.0.0.exe",
      "latest-linux.yml",
      "lawoss-linux-x86_64-2.0.0.AppImage",
      "latest-linux-arm64.yml",
      "lawoss-linux-arm64-2.0.0.AppImage",
    ])];
    const cases = [
      ["darwin", "arm64", "latest-mac.yml", "lawoss-mac-arm64-2.0.0.dmg"],
      ["darwin", "x64", "latest-mac.yml", "lawoss-mac-x64-2.0.0.dmg"],
      ["win32", "x64", "latest.yml", "lawoss-win-x64-2.0.0.exe"],
      ["linux", "x64", "latest-linux.yml", "lawoss-linux-x86_64-2.0.0.AppImage"],
      ["linux", "arm64", "latest-linux-arm64.yml", "lawoss-linux-arm64-2.0.0.AppImage"],
    ];
    for (const [platform, arch, manifestName, installerName] of cases) {
      const selected = selectAppRelease(releases, {
        platform,
        arch,
        currentVersion: "1.0.0",
        channel: "stable",
      });
      assert.equal(selected?.manifestName, manifestName);
      assert.equal(selected?.installerName, installerName);
    }
  });

  it("odmieta draft, prerelease, orchestrátor a preview aj keď sú novšie", () => {
    const appAssets = ["latest-mac.yml", "lawoss-mac-arm64-1.1.0.dmg"];
    const selected = selectAppRelease([
      githubRelease("v9.0.0", ["latest-mac.yml", "lawoss-mac-arm64-9.0.0.dmg"], { draft: true }),
      githubRelease("v8.0.0", ["latest-mac.yml", "lawoss-mac-arm64-8.0.0.dmg"], { prerelease: true }),
      githubRelease("legalwork-orchestrator-v7.0.0", appAssets),
      githubRelease("preview/logo-b-sidebar-20260910", appAssets),
      githubRelease("v1.1.0", appAssets),
    ], {
      platform: "darwin",
      arch: "arm64",
      currentVersion: "1.0.0",
      channel: "stable",
    });
    assert.equal(selected?.tag, "v1.1.0");
  });

  it("odmieta release bez manifestu alebo bez zodpovedajúceho inštalátora", () => {
    const options = { platform: "linux", arch: "arm64", currentVersion: "1.0.0", channel: "stable" };
    assert.equal(selectAppRelease([
      githubRelease("v1.2.0", ["lawoss-linux-arm64-1.2.0.AppImage"]),
    ], options), null);
    assert.equal(selectAppRelease([
      githubRelease("v1.2.0", ["latest-linux-arm64.yml", "lawoss-linux-x86_64-1.2.0.AppImage"]),
    ], options), null);
  });

  it("vyberá podľa verzie, nie poradia API, a podporuje LAWOSS suffix", () => {
    const selected = selectAppRelease([
      githubRelease("v1.10.0-lawoss.2", ["latest.yml", "legalwork-win-x64-1.10.0-lawoss.2.exe"]),
      githubRelease("v1.9.9", ["latest.yml", "lawoss-win-x64-1.9.9.exe"]),
      githubRelease("v1.10.0-lawoss.1", ["latest.yml", "lawoss-win-x64-1.10.0-lawoss.1.exe"]),
    ], {
      platform: "win32",
      arch: "x64",
      currentVersion: "1.9.0",
      channel: "stable",
    });
    assert.equal(selected?.tag, "v1.10.0-lawoss.2");
  });

  it("porovnáva LAWOSS poradové číslo numericky voči nainštalovanej verzii", () => {
    const selected = selectAppRelease([
      githubRelease("v1.10.0-lawoss.2", ["latest.yml", "lawoss-win-x64-1.10.0-lawoss.2.exe"]),
      githubRelease("v1.10.0-lawoss.10", ["latest.yml", "lawoss-win-x64-1.10.0-lawoss.10.exe"]),
    ], {
      platform: "win32",
      arch: "x64",
      currentVersion: "1.10.0-lawoss.2",
      channel: "stable",
    });
    assert.equal(selected?.tag, "v1.10.0-lawoss.10");
  });

  it("nikdy nevyberie rovnakú alebo staršiu verziu ani stable release pre alpha kanál", () => {
    const releases = [githubRelease("v1.0.0", ["latest-mac.yml", "lawoss-mac-arm64-1.0.0.dmg"])];
    const base = { platform: "darwin", arch: "arm64", currentVersion: "1.0.0" };
    assert.equal(selectAppRelease(releases, { ...base, channel: "stable" }), null);
    assert.equal(selectAppRelease(releases, { ...base, currentVersion: "2.0.0", channel: "stable" }), null);
    assert.equal(selectAppRelease(releases, { ...base, currentVersion: "0.1.0", channel: "alpha" }), null);
  });
});

describe("resolveGitHubAppFeed", () => {
  const options = { platform: "darwin", arch: "arm64", currentVersion: "1.0.0", channel: "stable" };

  it("vykoná jediný bounded request a odvodí feed iba z pevného repozitára a tagu", async () => {
    const requests = [];
    const fetch = async (url, init) => {
      requests.push({ url, init });
      return jsonResponse([
        githubRelease("v1.2.0", ["latest-mac.yml", "lawoss-mac-arm64-1.2.0.dmg"]),
      ]);
    };
    const result = await resolveGitHubAppFeed({ ...options, fetch });
    assert.equal(result.feedUrl, `${FORK_RELEASE_DOWNLOAD_BASE_URL}/v1.2.0`);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, GITHUB_APP_RELEASES_API_URL);
    assert.equal(requests[0].init.headers.Accept, "application/vnd.github+json");
    assert.ok(requests[0].init.signal instanceof AbortSignal);
  });

  it("vráti kontrolovanú chybu pre HTTP, timeout, neplatný JSON a neplatný tvar", async () => {
    await assert.rejects(resolveGitHubAppFeed({
      ...options,
      fetch: async () => jsonResponse([], { status: 503 }),
    }), /HTTP 503/);
    await assert.rejects(resolveGitHubAppFeed({
      ...options,
      fetch: async (_url, init) => {
        assert.ok(init?.signal instanceof AbortSignal);
        throw new DOMException("timed out", "AbortError");
      },
    }), /request failed: timed out/);
    await assert.rejects(resolveGitHubAppFeed({
      ...options,
      fetch: async () => jsonResponse("{"),
    }), /invalid JSON/);
    await assert.rejects(resolveGitHubAppFeed({
      ...options,
      fetch: async () => jsonResponse({ releases: [] }),
    }), /invalid release list/);
    await assert.rejects(resolveGitHubAppFeed({
      ...options,
      fetch: async () => jsonResponse(Array.from({ length: 21 }, () => ({}))),
    }), /invalid release list/);
    await assert.rejects(resolveGitHubAppFeed({
      ...options,
      fetch: async () => jsonResponse([
        { tag_name: 42, draft: false, prerelease: false, assets: [] },
        githubRelease("v1.2.0", ["latest-mac.yml", "lawoss-mac-arm64-1.2.0.dmg"]),
      ]),
    }), /invalid release list/);
    await assert.rejects(resolveGitHubAppFeed({
      ...options,
      fetch: async () => jsonResponse([]),
    }), /No suitable published/);
  });

  it("odmieta telo väčšie než jeden megabajt", async () => {
    const fetch = async () => jsonResponse(" ".repeat(1_000_001));
    await assert.rejects(resolveGitHubAppFeed({ ...options, fetch }), /too large/);
  });

  it("zastaví stream hneď po prekročení limitu tela", async () => {
    let reads = 0;
    let cancelled = false;
    const fetch = async () => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            reads += 1;
            return { done: false, value: new Uint8Array(600_000) };
          },
          cancel: async () => {
            cancelled = true;
          },
        }),
      },
      text: async () => assert.fail("streaming response must not be fully buffered"),
    });
    await assert.rejects(resolveGitHubAppFeed({ ...options, fetch }), /too large/);
    assert.equal(reads, 2);
    assert.equal(cancelled, true);
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
