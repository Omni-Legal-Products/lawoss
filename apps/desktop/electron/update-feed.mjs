// 🟡 LAWOSS: zdroj sťahovania správnej architektúry (issue #51).
//
// Upstream tok v main.mjs číta updater manifest zo sledovaného feedu a potom
// z GitHub `releases/latest/download`. Vo forku zlyhávajú oba: `lawoss.app/update`
// ešte nebeží (404) a `releases/latest` forku drží orchestrátorový sidecar,
// nie aplikáciu. Fallback preto mieri priamo na release aplikácie podľa tagu
// `v<verzia>` a názov assetu skladá podľa `artifactName` v electron-builder.yml.
// Releasy vydané pred premenovaním (v0.1.14) nesú prefix `legalwork-`, novšie
// `lawoss-`: skúša sa preferovaný prefix a pri 404 druhý.

export const FORK_RELEASE_DOWNLOAD_BASE_URL =
  "https://github.com/Omni-Legal-Products/lawoss/releases/download";

export const GITHUB_APP_RELEASES_API_URL =
  "https://api.github.com/repos/Omni-Legal-Products/lawoss/releases?per_page=20";

const GITHUB_RELEASES_TIMEOUT_MS = 5_000;
const GITHUB_RELEASES_MAX_BYTES = 1_000_000;
const GITHUB_RELEASES_MAX_ITEMS = 20;
const APP_RELEASE_TAG = /^v(\d+\.\d+\.\d+(?:-lawoss\.\d+)?)$/;

/** @typedef {{ name: string }} GitHubReleaseAsset */
/** @typedef {{ tag_name: string, draft: boolean, prerelease: boolean, assets: GitHubReleaseAsset[] }} GitHubRelease */
/** @typedef {{ read(): Promise<{ done: boolean, value?: Uint8Array }>, cancel(): Promise<unknown>, releaseLock?(): void }} BodyReader */
/** @typedef {(url: string, init?: RequestInit) => Promise<{ ok: boolean, status: number, headers?: { get?(name: string): string | null }, body?: { getReader(): BodyReader } | null, text(): Promise<string> }>} GitHubFetch */

// Poradie = preferencia. Prvý zodpovedá aktuálnemu `artifactName`, druhý
// releasom spred premenovania; vyhodiť, keď posledný `legalwork-*` release
// prestane byť podporovaný.
export const RELEASE_ASSET_PREFIXES = Object.freeze(["lawoss", "legalwork"]);

// Renderer čaká na výsledok pred prvým vykreslením — visiaci feed by držal
// prázdne okno, preto má každá požiadavka strop.
const FEED_TIMEOUT_MS = 5_000;

const loggedOnce = new Set();
function logOnce(message) {
  if (loggedOnce.has(message)) return;
  loggedOnce.add(message);
  console.info(message);
}

// Zrkadlí `${os}` a `${ext}` z electron-builder.yml pre inštalátor, ktorý sa
// ponúka na stiahnutie (dmg / nsis exe / AppImage).
function installerParts(platform) {
  if (platform === "darwin") return { slug: "mac", extension: "dmg" };
  if (platform === "win32") return { slug: "win", extension: "exe" };
  return { slug: "linux", extension: "AppImage" };
}

/**
 * Názov inštalátora podľa `artifactName: <prefix>-${os}-${arch}-${version}.${ext}`.
 * electron-builder pomenúva x64 AppImage `x86_64`; dmg a exe ostávajú `x64`.
 * @param {{ platform: string, arch: string, version: string, prefix?: string }} input
 */
export function releaseAssetName({ platform, arch, version, prefix = RELEASE_ASSET_PREFIXES[0] }) {
  const { slug, extension } = installerParts(platform);
  const assetArch = extension === "AppImage" && arch === "x64" ? "x86_64" : arch;
  return `${prefix}-${slug}-${assetArch}-${version}.${extension}`;
}

/**
 * URL inštalátora v release aplikácie forku podľa tagu `v<verzia>`.
 * @param {{ platform: string, arch: string, version: string, prefix?: string }} input
 */
export function releaseAssetUrl({ platform, arch, version, prefix }) {
  return `${FORK_RELEASE_DOWNLOAD_BASE_URL}/v${version}/${releaseAssetName({ platform, arch, version, prefix })}`;
}

function updaterManifestName(platform, arch) {
  if (platform === "darwin") return "latest-mac.yml";
  if (platform === "win32") return "latest.yml";
  if (platform === "linux" && arch === "arm64") return "latest-linux-arm64.yml";
  if (platform === "linux") return "latest-linux.yml";
  return null;
}

function parseAppVersion(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-lawoss\.(\d+))?$/);
  if (!match) return null;
  return {
    release: match.slice(1, 4).map(Number),
    lawoss: match[4] === undefined ? null : Number(match[4]),
  };
}

function compareAppVersions(left, right) {
  const parsedLeft = parseAppVersion(left);
  const parsedRight = parseAppVersion(right);
  if (!parsedLeft || !parsedRight) return null;
  for (let index = 0; index < parsedLeft.release.length; index += 1) {
    if (parsedLeft.release[index] !== parsedRight.release[index]) {
      return parsedLeft.release[index] < parsedRight.release[index] ? -1 : 1;
    }
  }
  if (parsedLeft.lawoss === parsedRight.lawoss) return 0;
  if (parsedLeft.lawoss === null) return 1;
  if (parsedRight.lawoss === null) return -1;
  return parsedLeft.lawoss < parsedRight.lawoss ? -1 : 1;
}

/** @param {unknown} value @returns {value is GitHubRelease} */
function isGitHubRelease(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !("tag_name" in value) ||
    !("draft" in value) ||
    !("prerelease" in value) ||
    !("assets" in value) ||
    typeof value.tag_name !== "string" ||
    typeof value.draft !== "boolean" ||
    typeof value.prerelease !== "boolean" ||
    !Array.isArray(value.assets) ||
    value.assets.length > 200
  ) {
    return false;
  }
  return value.assets.every((asset) =>
    asset &&
    typeof asset === "object" &&
    "name" in asset &&
    typeof asset.name === "string" &&
    asset.name.length <= 255,
  );
}

/** @param {GitHubRelease} release */
function releaseAssetNames(release) {
  const names = new Set();
  for (const asset of release.assets) {
    names.add(asset.name);
  }
  return names;
}

/** @param {unknown} releases @returns {releases is GitHubRelease[]} */
function validReleaseList(releases) {
  return Array.isArray(releases) &&
    releases.length <= GITHUB_RELEASES_MAX_ITEMS &&
    releases.every(isGitHubRelease);
}

/** @param {{ body?: { getReader(): BodyReader } | null, text(): Promise<string> }} response */
async function readBoundedResponseText(response) {
  if (!response.body?.getReader) {
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > GITHUB_RELEASES_MAX_BYTES) {
      throw new Error("GitHub release API response is too large");
    }
    return raw;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new Error("GitHub release API returned an invalid response body");
      }
      bytes += value.byteLength;
      if (bytes > GITHUB_RELEASES_MAX_BYTES) {
        await reader.cancel();
        throw new Error("GitHub release API response is too large");
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } finally {
    reader.releaseLock?.();
  }
}

/**
 * Vyberie najnovšie vhodné stabilné vydanie aplikácie pre daný runtime.
 * URL z GitHub payloadu sa zámerne nepoužívajú.
 * @param {unknown[]} releases
 * @param {{ platform: string, arch: string, currentVersion: string, channel: string }} options
 */
export function selectAppRelease(releases, { platform, arch, currentVersion, channel }) {
  if (!Array.isArray(releases) || channel !== "stable") return null;
  const manifestName = updaterManifestName(platform, arch);
  if (!manifestName || !parseAppVersion(currentVersion)) return null;

  let selected = null;
  for (const release of releases) {
    if (!isGitHubRelease(release) || release.draft !== false || release.prerelease !== false) {
      continue;
    }
    const tagMatch = typeof release.tag_name === "string" ? release.tag_name.match(APP_RELEASE_TAG) : null;
    if (!tagMatch) continue;
    const version = tagMatch[1];
    const newer = compareAppVersions(version, currentVersion);
    if (newer === null || newer <= 0) continue;
    const assetNames = releaseAssetNames(release);
    if (!assetNames.has(manifestName)) continue;
    const installerName = RELEASE_ASSET_PREFIXES
      .map((prefix) => releaseAssetName({ platform, arch, version, prefix }))
      .find((name) => assetNames.has(name));
    if (!installerName) continue;
    if (selected && compareAppVersions(version, selected.version) <= 0) continue;
    selected = {
      tag: release.tag_name,
      version,
      manifestName,
      installerName,
      feedUrl: `${FORK_RELEASE_DOWNLOAD_BASE_URL}/${encodeURIComponent(release.tag_name)}`,
    };
  }
  return selected;
}

/**
 * Urobí jediný ohraničený GitHub API request a vráti pevný tagový generic feed.
 * @param {object} options
 * @param {string} options.platform
 * @param {string} options.arch
 * @param {string} options.currentVersion
 * @param {string} options.channel
 * @param {GitHubFetch} [options.fetch]
 */
export async function resolveGitHubAppFeed({
  platform,
  arch,
  currentVersion,
  channel,
  fetch = globalThis.fetch,
}) {
  let response;
  try {
    response = await fetch(GITHUB_APP_RELEASES_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(GITHUB_RELEASES_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`GitHub release API request failed: ${error?.message ?? error}`, { cause: error });
  }
  if (!response?.ok) {
    throw new Error(`GitHub release API returned HTTP ${response?.status ?? "unknown"}`);
  }
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > GITHUB_RELEASES_MAX_BYTES) {
    throw new Error("GitHub release API response is too large");
  }
  const raw = await readBoundedResponseText(response);
  let releases;
  try {
    releases = JSON.parse(raw);
  } catch (error) {
    throw new Error("GitHub release API returned invalid JSON", { cause: error });
  }
  if (!validReleaseList(releases)) {
    throw new Error("GitHub release API returned an invalid release list");
  }
  const selected = selectAppRelease(releases, { platform, arch, currentVersion, channel });
  if (!selected) {
    throw new Error("No suitable published LAWOSS app release is available");
  }
  return selected;
}

/**
 * @typedef {(url: string, init?: RequestInit) => Promise<{ ok: boolean, status: number, text(): Promise<string> }>} FeedFetch
 */

/**
 * Vráti URL inštalátora pre danú architektúru, alebo null, keď nič nie je
 * k dispozícii. Nikdy nevyhodí — aplikácia beží ďalej bez ponuky sťahovania.
 * @param {object} input
 * @param {string} input.manifestUrl updater manifest na sledovanom feede
 * @param {(raw: string) => string | null | undefined} input.selectFromManifest vyberie URL alebo názov assetu z manifestu
 * @param {string} input.platform
 * @param {string} input.arch
 * @param {string} input.version
 * @param {FeedFetch} [input.fetch]
 * @returns {Promise<string | null>}
 */
export async function resolveArchitectureDownloadUrl({
  manifestUrl,
  selectFromManifest,
  platform,
  arch,
  version,
  fetch = globalThis.fetch,
}) {
  const fromManifest = await resolveFromManifest({ manifestUrl, selectFromManifest, fetch });
  if (fromManifest) return fromManifest;
  for (const prefix of RELEASE_ASSET_PREFIXES) {
    const url = releaseAssetUrl({ platform, arch, version, prefix });
    if (await assetExists(url, fetch)) return url;
  }
  logOnce(
    `[architecture] release v${version} nemá inštalátor pre ${arch} (${FORK_RELEASE_DOWNLOAD_BASE_URL}/v${version}) — ponuka sťahovania sa nezobrazí`,
  );
  return null;
}

/** @param {{ manifestUrl: string, selectFromManifest: (raw: string) => string | null | undefined, fetch: FeedFetch }} input */
async function resolveFromManifest({ manifestUrl, selectFromManifest, fetch }) {
  try {
    const response = await fetch(manifestUrl, {
      headers: { Accept: "text/yaml, text/plain, */*" },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const selected = selectFromManifest(await response.text());
    // Manifest bez zhody = nedostupný feed: 200 s cudzím telom (maintenance
    // stránka, bot challenge) sa rozparsuje na nič a nesmie preskočiť fallback.
    if (!selected) throw new Error("manifest neobsahuje zodpovedajúci asset");
    return new URL(selected, manifestUrl).toString();
  } catch (error) {
    // Jediný tichý riadok na beh — sledovaný feed dnes 404-kuje pri každom štarte.
    logOnce(
      `[architecture] sledovaný feed nedostupný (${manifestUrl}: ${error?.message ?? error}), skúšam release na GitHube`,
    );
    return null;
  }
}

/** @param {string} url @param {FeedFetch} fetch */
async function assetExists(url, fetch) {
  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}
