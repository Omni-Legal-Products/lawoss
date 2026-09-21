import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import {
  ELECTRON_UPDATER_FEEDS,
  checkForUpdatesWithFeedFallback,
  formatUpdaterErrorReason,
  staleUpdaterStatePaths,
} from "./updater.mjs";

// 🟡 LAWOSS: testy čítajú tracked feed z modulu namiesto literálu, aby
// presmerovanie feedu vo forku (PATCHES.md) nerozbilo upstream testy.
const STABLE_FEED = ELECTRON_UPDATER_FEEDS.stable;
const STABLE_ORIGIN = new URL(STABLE_FEED).origin;
const GITHUB_TAG_FEED = "https://github.com/Omni-Legal-Products/lawoss/releases/download/v0.2.0";

const fakeApp = { getPath: (key) => (key === "home" ? "/Users/test" : `/Users/test/${key}`) };

/* A shipped app that can no longer self-update is the worst failure mode, so
   the feed fallback chain gets exercised directly: primary feed -> GitHub. */
describe("checkForUpdatesWithFeedFallback", () => {
  // No channel file in this userData dir -> the stable channel is used.
  const feedApp = {
    isPackaged: true,
    getVersion: () => "0.1.0",
    getPath: () => path.join(os.tmpdir(), "legalwork-updater-test-userdata"),
  };

  // `versions` maps a feed-URL prefix to the version that feed advertises
  // (default "9.9.9", i.e. an available update).
  function fakeUpdater({ failFeeds, versions = {} }) {
    return {
      feedUrls: [],
      downloadFeedUrls: [],
      setFeedURL({ url }) {
        this.feedUrls.push(url);
      },
      async checkForUpdates() {
        const current = this.feedUrls[this.feedUrls.length - 1];
        if (failFeeds.some((feed) => current.startsWith(feed))) {
          throw new Error(`feed unreachable: ${current}`);
        }
        const match = Object.entries(versions).find(([feed]) => current.startsWith(feed));
        return { updateInfo: { version: match ? match[1] : "9.9.9" } };
      },
      async downloadUpdate() {
        this.downloadFeedUrls.push(this.feedUrls[this.feedUrls.length - 1]);
      },
    };
  }

  /** @param {{ status?: number, releases?: object[] }} [options] */
  function githubReleaseFetch({ status = 200, releases } = {}) {
    const requests = [];
    const body = releases ?? [
      {
        tag_name: "v0.2.0",
        draft: false,
        prerelease: false,
        assets: [
          { name: "latest-mac.yml" },
          { name: "lawoss-mac-arm64-0.2.0.dmg" },
        ],
      },
    ];
    return {
      requests,
      fetch: async (url) => {
        requests.push(url);
        return {
          ok: status >= 200 && status < 300,
          status,
          text: async () => JSON.stringify(body),
        };
      },
    };
  }

  function githubReleaseFixture(tag, options = {}) {
    const version = tag.slice(1);
    return {
      tag_name: tag,
      draft: options.draft ?? false,
      prerelease: options.prerelease ?? false,
      assets: [
        { name: "latest-mac.yml" },
        { name: `lawoss-mac-arm64-${version}.dmg` },
      ],
    };
  }

  const stableFallbackOptions = (feed) => ({
    fetch: feed.fetch,
    platform: "darwin",
    arch: "arm64",
  });

  it("uses the tracked feed when it answers", async () => {
    const updater = fakeUpdater({ failFeeds: [] });
    let apiRequests = 0;
    const { channelState, result } = await checkForUpdatesWithFeedFallback(feedApp, updater, {
      fetch: async () => {
        apiRequests += 1;
        throw new Error("GitHub API must not run for a newer primary result");
      },
    });
    assert.equal(channelState.feedUrl, STABLE_FEED);
    assert.equal(channelState.feedFallback, false);
    assert.equal(result.updateInfo.version, "9.9.9");
    assert.deepEqual(updater.feedUrls, [STABLE_FEED]);
    assert.equal(apiRequests, 0);
    assert.equal(updater.downloadFeedUrls.length, 0);
  });

  it("ponechá vybraný tagový provider pre následné explicitné stiahnutie", async () => {
    const updater = fakeUpdater({ failFeeds: [STABLE_ORIGIN] });
    const feed = githubReleaseFetch();
    await checkForUpdatesWithFeedFallback(feedApp, updater, stableFallbackOptions(feed));
    assert.equal(updater.downloadFeedUrls.length, 0);
    await updater.downloadUpdate();
    assert.deepEqual(updater.downloadFeedUrls, [GITHUB_TAG_FEED]);
  });

  it("falls back to GitHub when the tracked feed errors", async () => {
    const updater = fakeUpdater({ failFeeds: [STABLE_ORIGIN] });
    const feed = githubReleaseFetch({
      releases: [
          {
            tag_name: "legalwork-orchestrator-v9.9.9",
            draft: false,
            prerelease: false,
            assets: [{ name: "legalwork-orchestrator-darwin-arm64" }],
          },
          {
            tag_name: "v0.2.0",
            draft: false,
            prerelease: false,
            assets: [
              { name: "latest-mac.yml" },
              { name: "lawoss-mac-arm64-0.2.0.dmg" },
            ],
          },
      ],
    });
    const { channelState, result } = await checkForUpdatesWithFeedFallback(
      feedApp,
      updater,
      stableFallbackOptions(feed),
    );
    assert.equal(channelState.feedFallback, true);
    assert.equal(channelState.feedUrl, GITHUB_TAG_FEED);
    assert.equal(result.updateInfo.version, "9.9.9");
    assert.equal(feed.requests.length, 1);
    // The GitHub feed must stay applied so the follow-up download uses it too.
    assert.equal(
      updater.feedUrls[updater.feedUrls.length - 1],
      GITHUB_TAG_FEED,
    );
  });

  it("throws only when both feeds fail, tagging the error against redundant retries", async () => {
    const updater = fakeUpdater({ failFeeds: [STABLE_ORIGIN, "https://github.com"] });
    const feed = githubReleaseFetch();
    const error = await checkForUpdatesWithFeedFallback(feedApp, updater, stableFallbackOptions(feed)).then(
      () => assert.fail("expected rejection"),
      (rejection) => rejection,
    );
    assert.match(String(error?.message), /feed unreachable: https:\/\/github\.com/);
    // The tag tells the IPC handlers' last-ditch recovery that GitHub was
    // already tried, so they don't repeat the identical request.
    assert.equal(error.githubFallbackAttempted, true);
    assert.equal(feed.requests.length, 1);
  });

  it("po chybe primáru a API skončí po jednom API pokuse bez druhého fallbacku", async () => {
    const updater = fakeUpdater({ failFeeds: [STABLE_ORIGIN] });
    const feed = githubReleaseFetch({ status: 503 });
    const error = await checkForUpdatesWithFeedFallback(feedApp, updater, stableFallbackOptions(feed)).then(
      () => assert.fail("expected rejection"),
      (rejection) => rejection,
    );
    assert.match(String(error?.message), /HTTP 503/);
    assert.equal(error.githubFallbackAttempted, true);
    assert.equal(feed.requests.length, 1);
    assert.deepEqual(updater.feedUrls, [STABLE_FEED]);
  });

  it("prerelease release nie je dostupný pre stable kanál", async () => {
    const updater = fakeUpdater({ failFeeds: [STABLE_ORIGIN] });
    const feed = githubReleaseFetch({
      releases: [githubReleaseFixture("v0.1.14", { prerelease: true })],
    });
    const error = await checkForUpdatesWithFeedFallback(feedApp, updater, stableFallbackOptions(feed)).then(
      () => assert.fail("expected rejection"),
      (rejection) => rejection,
    );
    assert.match(String(error?.message), /No suitable published/);
    assert.equal(error.githubFallbackAttempted, true);
    assert.equal(feed.requests.length, 1);
  });

  /* A tracked feed that answers with valid-but-stale data never errors, so the
     error fallback alone would pin the fleet on the current version. The
     freshness cross-check is what heals that. */
  it("cross-checks GitHub on 'no update' and prefers the newer version", async () => {
    const updater = fakeUpdater({
      failFeeds: [],
      versions: { [STABLE_ORIGIN]: "0.1.0" }, // stale: equals current
    });
    const feed = githubReleaseFetch();
    const { channelState, result } = await checkForUpdatesWithFeedFallback(
      feedApp,
      updater,
      stableFallbackOptions(feed),
    );
    assert.equal(result.updateInfo.version, "9.9.9");
    assert.equal(channelState.feedFallback, true);
    assert.equal(channelState.feedUrl, GITHUB_TAG_FEED);
    // GitHub must stay applied so the follow-up download resolves against it.
    assert.equal(
      updater.feedUrls[updater.feedUrls.length - 1],
      GITHUB_TAG_FEED,
    );
  });

  it("keeps the tracked feed's answer when GitHub agrees there is no update", async () => {
    const updater = fakeUpdater({
      failFeeds: [],
      versions: { [STABLE_ORIGIN]: "0.1.0", [GITHUB_TAG_FEED]: "0.1.0" },
    });
    const feed = githubReleaseFetch();
    const { channelState, result } = await checkForUpdatesWithFeedFallback(
      feedApp,
      updater,
      stableFallbackOptions(feed),
    );
    assert.equal(result.updateInfo.version, "0.1.0");
    assert.equal(channelState.feedFallback, false);
    // The tracked feed is re-applied after the cross-check.
    assert.equal(
      updater.feedUrls[updater.feedUrls.length - 1],
      STABLE_FEED,
    );
  });

  it("ignores a failing GitHub cross-check when the tracked feed answered", async () => {
    const updater = fakeUpdater({
      failFeeds: ["https://github.com"],
      versions: { [STABLE_ORIGIN]: "0.1.0" },
    });
    const feed = githubReleaseFetch({ status: 503 });
    const { channelState, result } = await checkForUpdatesWithFeedFallback(
      feedApp,
      updater,
      stableFallbackOptions(feed),
    );
    assert.equal(result.updateInfo.version, "0.1.0");
    assert.equal(channelState.feedFallback, false);
    assert.equal(
      updater.feedUrls[updater.feedUrls.length - 1],
      STABLE_FEED,
    );
  });

  it("neopakuje API, keď po cross-checku zlyhá obnovenie primárneho provideru", async () => {
    const updater = fakeUpdater({
      failFeeds: [],
      versions: { [STABLE_ORIGIN]: "0.1.0", [GITHUB_TAG_FEED]: "0.1.0" },
    });
    const setFeedURL = updater.setFeedURL.bind(updater);
    let primaryApplications = 0;
    updater.setFeedURL = ({ url }) => {
      if (url === STABLE_FEED && ++primaryApplications === 2) {
        throw new Error("primary restore failed");
      }
      setFeedURL({ url });
    };
    const feed = githubReleaseFetch();
    const { channelState, result } = await checkForUpdatesWithFeedFallback(
      feedApp,
      updater,
      stableFallbackOptions(feed),
    );
    assert.equal(result.updateInfo.version, "0.1.0");
    assert.equal(channelState.feedFallback, false);
    assert.equal(feed.requests.length, 1);
  });

  it("skips the check entirely for an unstamped 0.0.0 local build (LAWOSS)", async () => {
    const updater = fakeUpdater({ failFeeds: [] });
    const localApp = { ...feedApp, getVersion: () => "0.0.0" };
    let apiRequests = 0;
    const { result } = await checkForUpdatesWithFeedFallback(localApp, updater, {
      fetch: async () => {
        apiRequests += 1;
        throw new Error("unexpected API request");
      },
    });
    assert.equal(result, null);
    // Feed gets applied (so a later manual check works) but nothing is fetched.
    assert.deepEqual(updater.feedUrls, [STABLE_FEED]);
    assert.equal(apiRequests, 0);
  });

  it("alpha kanál nemení a nikdy preň nevolá stable releases API", {
    skip: process.platform !== "darwin" && process.platform !== "win32",
  }, async () => {
    const userData = await mkdtemp(path.join(os.tmpdir(), "lawoss-updater-alpha-"));
    try {
      await writeFile(
        path.join(userData, "electron-updater-channel.v1.json"),
        JSON.stringify({ channel: "alpha" }),
      );
      const app = { ...feedApp, getPath: () => userData };
      const updater = fakeUpdater({
        failFeeds: [],
        versions: { [ELECTRON_UPDATER_FEEDS.alpha]: "0.1.0" },
      });
      let apiRequests = 0;
      const { channelState, result } = await checkForUpdatesWithFeedFallback(app, updater, {
        fetch: async () => {
          apiRequests += 1;
          throw new Error("unexpected stable API request");
        },
      });
      assert.equal(channelState.channel, "alpha");
      assert.equal(result.updateInfo.version, "0.1.0");
      assert.deepEqual(updater.feedUrls, [ELECTRON_UPDATER_FEEDS.alpha]);
      assert.equal(apiRequests, 0);
    } finally {
      await rm(userData, { recursive: true, force: true });
    }
  });
});

describe("staleUpdaterStatePaths", () => {
  it("targets the ShipIt cache on macOS", { skip: process.platform !== "darwin" }, () => {
    assert.deepEqual(staleUpdaterStatePaths(fakeApp), [
      "/Users/test/Library/Caches/com.eigenweltlabs.legalwork.ShipIt",
    ]);
  });

  it("is a no-op off macOS", { skip: process.platform === "darwin" }, () => {
    assert.deepEqual(staleUpdaterStatePaths(fakeApp), []);
  });
});

describe("formatUpdaterErrorReason", () => {
  it("explains that a local build without app-update.yml cannot self-update", () => {
    const error = Object.assign(
      new Error("ENOENT: no such file or directory, open '/Applications/LawOSS.app/Contents/Resources/app-update.yml'"),
      { code: "ENOENT" },
    );

    assert.equal(
      formatUpdaterErrorReason(error),
      "This local LAWOSS build cannot update itself because it has no updater configuration. Install a versioned LAWOSS release instead.",
    );
  });

  it("keeps unrelated updater errors unchanged", () => {
    const error = new Error("network timeout");
    assert.equal(formatUpdaterErrorReason(error), "network timeout");
  });
});
