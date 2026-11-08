import semver from "semver";

export const RELEASE_REPOSITORY = "eigenweltlabs/legalwork";
const RELEASE_API = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases`;

export function compareVersions(left, right) {
  const a = typeof left === "string" ? semver.valid(left) : null;
  const b = typeof right === "string" ? semver.valid(right) : null;
  return a && b ? semver.compare(a, b) : null;
}

export function releaseIdentity(release) {
  if (!release || release.draft || !release.published_at) return null;
  const tag = release.tag_name;
  if (typeof tag !== "string") return null;
  const alpha = tag.match(/^alpha-(macos|windows-(?:x64|arm64))-v(\d+\.\d+\.\d+-alpha\.\d+)-([a-f0-9]+)$/);
  if (alpha) {
    const version = semver.valid(`${alpha[2]}.g${alpha[3]}`);
    return version ? { version, kind: "alpha" } : null;
  }
  if (!tag.startsWith("v") || !semver.valid(tag)) return null;
  const version = semver.valid(tag);
  // Alpha is never admitted by the Pre-release checkbox alone.
  if (semver.prerelease(version)?.[0] === "alpha") return { version, kind: "alpha" };
  return { version, kind: release.prerelease ? "prerelease" : "stable" };
}

export function manifestName(platform, arch) {
  if (platform === "darwin") return "latest-mac.yml";
  if (platform === "win32") return arch === "arm64" ? "latest-arm64.yml" : "latest.yml";
  if (platform === "linux") return arch === "arm64" ? "latest-linux-arm64.yml" : "latest-linux.yml";
  throw new Error(`Unsupported update platform: ${platform}`);
}

export function selectReleaseFeed(releases, channel, platform, arch) {
  if (!["stable", "prerelease", "alpha"].includes(channel)) throw new Error("Invalid release channel");
  if (!["x64", "arm64"].includes(arch)) throw new Error(`Unsupported update architecture: ${arch}`);
  const manifest = manifestName(platform, arch);
  const installerPrefix = platform === "darwin" ? `legalwork-mac-${arch}-`
    : platform === "win32" ? `legalwork-win-${arch}-`
      : `legalwork-linux-${arch === "x64" ? "x86_64" : arch}-`;
  const extension = platform === "darwin" ? ".zip" : platform === "win32" ? ".exe" : ".AppImage";
  let selected = null;
  for (const release of releases) {
    const identity = releaseIdentity(release);
    if (!identity || (identity.kind === "alpha" && channel !== "alpha") || (identity.kind === "prerelease" && channel === "stable")) continue;
    const assets = release.assets ?? [];
    const uploaded = (asset) => asset.state === "uploaded" && asset.size > 0;
    if (!assets.some((a) => a.name === manifest && uploaded(a)) || !assets.some((a) => a.name.startsWith(installerPrefix) && a.name.endsWith(extension) && uploaded(a))) continue;
    if (selected && compareVersions(identity.version, selected.version) <= 0) continue;
    selected = {
      ...identity,
      tag: release.tag_name,
      releaseId: release.id,
      manifest,
      assetNames: assets.filter(uploaded).map((asset) => asset.name),
      feedUrl: `https://github.com/${RELEASE_REPOSITORY}/releases/download/${encodeURIComponent(release.tag_name)}`,
    };
  }
  return selected;
}

// Cache only briefly: editing the GitHub Pre-release flag must take effect
// without a build. Fetch every page; API order and the Latest badge are not
// version order. No stale cache is returned after an API failure.
export function createReleaseFeedResolver({ fetchImpl = fetch, now = Date.now, cacheMs = 60_000, token = "" } = {}) {
  let cached = null;
  let expires = 0;
  let pending = null;
  async function load() {
    const releases = [];
    let url = `${RELEASE_API}?per_page=100`;
    const seen = new Set();
    while (url) {
      const pageUrl = new URL(url);
      // GitHub's Link header uses its canonical numeric repository endpoint.
      const ownPath = pageUrl.pathname === `/repos/${RELEASE_REPOSITORY}/releases`
        || pageUrl.pathname === "/repositories/1278160330/releases";
      if (seen.has(url) || pageUrl.origin !== "https://api.github.com" || !ownPath || pageUrl.username || pageUrl.password) throw new Error("Invalid release pagination");
      seen.add(url);
      const response = await fetchImpl(url, {
        headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Release metadata unavailable (${response.status})`);
      const page = await response.json();
      if (!Array.isArray(page)) throw new Error("Invalid release metadata");
      releases.push(...page);
      url = response.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? "";
    }
    cached = releases;
    expires = now() + cacheMs;
    return releases;
  }
  return async (channel, platform = process.platform, arch = process.arch) => {
    if (!cached || now() >= expires) {
      pending ??= load().finally(() => { pending = null; });
      await pending;
    }
    return selectReleaseFeed(cached, channel, platform, arch);
  };
}

export const resolveReleaseFeed = createReleaseFeedResolver();
