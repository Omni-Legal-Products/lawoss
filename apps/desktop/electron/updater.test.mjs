import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import {
  ELECTRON_UPDATER_FALLBACK_FEEDS,
  ELECTRON_UPDATER_FEEDS,
  checkForUpdatesWithFeedFallback,
  formatUpdaterErrorReason,
  staleUpdaterStatePaths,
} from "./updater.mjs";

// 🟡 LAWOSS: testy čítajú tracked feed z modulu namiesto literálu, aby
// presmerovanie feedu vo forku (PATCHES.md) nerozbilo upstream testy.
const STABLE_FEED = ELECTRON_UPDATER_FEEDS.stable;
const STABLE_ORIGIN = new URL(STABLE_FEED).origin;

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
    };
  }

  it("uses the tracked feed when it answers", async () => {
    const updater = fakeUpdater({ failFeeds: [] });
    const { channelState, result } = await checkForUpdatesWithFeedFallback(feedApp, updater);
    assert.equal(channelState.feedUrl, STABLE_FEED);
    assert.equal(channelState.feedFallback, false);
    assert.equal(result.updateInfo.version, "9.9.9");
    assert.deepEqual(updater.feedUrls, [STABLE_FEED]);
  });

  it("falls back to GitHub when the tracked feed errors", async () => {
    const updater = fakeUpdater({ failFeeds: [STABLE_ORIGIN] });
    const { channelState, result } = await checkForUpdatesWithFeedFallback(feedApp, updater);
    assert.equal(channelState.feedFallback, true);
    assert.equal(channelState.feedUrl, ELECTRON_UPDATER_FALLBACK_FEEDS.stable);
    assert.equal(result.updateInfo.version, "9.9.9");
    // The GitHub feed must stay applied so the follow-up download uses it too.
    assert.equal(
      updater.feedUrls[updater.feedUrls.length - 1],
      ELECTRON_UPDATER_FALLBACK_FEEDS.stable,
    );
  });

  it("throws only when both feeds fail, tagging the error against redundant retries", async () => {
    const updater = fakeUpdater({ failFeeds: [STABLE_ORIGIN, "https://github.com"] });
    const error = await checkForUpdatesWithFeedFallback(feedApp, updater).then(
      () => assert.fail("expected rejection"),
      (rejection) => rejection,
    );
    assert.match(String(error?.message), /feed unreachable: https:\/\/github\.com/);
    // The tag tells the IPC handlers' last-ditch recovery that GitHub was
    // already tried, so they don't repeat the identical request.
    assert.equal(error.githubFallbackAttempted, true);
  });

  /* A tracked feed that answers with valid-but-stale data never errors, so the
     error fallback alone would pin the fleet on the current version. The
     freshness cross-check is what heals that. */
  it("cross-checks GitHub on 'no update' and prefers the newer version", async () => {
    const updater = fakeUpdater({
      failFeeds: [],
      versions: { [STABLE_ORIGIN]: "0.1.0" }, // stale: equals current
    });
    const { channelState, result } = await checkForUpdatesWithFeedFallback(feedApp, updater);
    assert.equal(result.updateInfo.version, "9.9.9");
    assert.equal(channelState.feedFallback, true);
    assert.equal(channelState.feedUrl, ELECTRON_UPDATER_FALLBACK_FEEDS.stable);
    // GitHub must stay applied so the follow-up download resolves against it.
    assert.equal(
      updater.feedUrls[updater.feedUrls.length - 1],
      ELECTRON_UPDATER_FALLBACK_FEEDS.stable,
    );
  });

  it("keeps the tracked feed's answer when GitHub agrees there is no update", async () => {
    const updater = fakeUpdater({
      failFeeds: [],
      versions: { [STABLE_ORIGIN]: "0.1.0", "https://github.com": "0.1.0" },
    });
    const { channelState, result } = await checkForUpdatesWithFeedFallback(feedApp, updater);
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
    const { channelState, result } = await checkForUpdatesWithFeedFallback(feedApp, updater);
    assert.equal(result.updateInfo.version, "0.1.0");
    assert.equal(channelState.feedFallback, false);
    assert.equal(
      updater.feedUrls[updater.feedUrls.length - 1],
      STABLE_FEED,
    );
  });

  it("skips the check entirely for an unstamped 0.0.0 local build (LAWOSS)", async () => {
    const updater = fakeUpdater({ failFeeds: [] });
    const localApp = { ...feedApp, getVersion: () => "0.0.0" };
    const { result } = await checkForUpdatesWithFeedFallback(localApp, updater);
    assert.equal(result, null);
    // Feed gets applied (so a later manual check works) but nothing is fetched.
    assert.deepEqual(updater.feedUrls, [STABLE_FEED]);
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
