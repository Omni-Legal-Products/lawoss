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
