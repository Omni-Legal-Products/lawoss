/**
 * LAWOSS: hlásenie chýb a upozornenie na novú alfu pre testerov.
 * Nepodpísané alfa buildy neposúvajú `alpha-*-latest`, takže vstavaný updater o novej alfe nevie.
 * Web lawoss.app zverejňuje najnovšiu alfu na /api/alfa/verzia; appka ju len číta, nič neposiela.
 */

const SITE = "https://lawoss.app";
const SITE_LOCALES = { sk: "sk", cs: "cz", en: "en", de: "en" };

/** @param {string} locale */
export function siteLocale(locale) {
  return SITE_LOCALES[/** @type {keyof typeof SITE_LOCALES} */ (String(locale).slice(0, 2).toLowerCase())] ?? "sk";
}

/** Kľúč platformy tak, ako ho používa /api/alfa/verzia. */
export function alphaPlatform(platform = process.platform, arch = process.arch) {
  if (platform === "darwin") return "mac";
  if (platform === "win32") return arch === "arm64" ? "win-arm64" : "win-x64";
  return "";
}

/** Formulár hlásenia; verzia a systém idú v odkaze, aby ich tester nemusel hľadať. Žiadne osobné údaje. */
export function feedbackUrl({ locale, version, platform = process.platform, arch = process.arch }) {
  const url = new URL(`${SITE}/${siteLocale(locale)}/alfa/hlasenie`);
  const system = alphaPlatform(platform, arch);
  if (version) url.searchParams.set("verzia", String(version).slice(0, 60));
  if (system) url.searchParams.set("system", system);
  return url.toString();
}

export function alphaPageUrl(locale) {
  return `${SITE}/${siteLocale(locale)}/alfa`;
}

/** „0.2.1-alpha.12.ge0dd860“ → { base: [0,2,1], alpha: 12 }; iné tvary → undefined. */
export function parseAlphaVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)-alpha\.(\d+)/.exec(String(version ?? ""));
  if (!match) return undefined;
  return { base: [Number(match[1]), Number(match[2]), Number(match[3])], alpha: Number(match[4]) };
}

/** Vráti verziu novšej alfy pre túto platformu, inak prázdny reťazec. */
export function newerAlpha(current, payload, platform = alphaPlatform()) {
  const mine = parseAlphaVersion(current);
  const entry = payload && typeof payload === "object" ? payload[platform] : undefined;
  const latest = entry && typeof entry.version === "string" ? entry.version.slice(0, 60) : "";
  const theirs = parseAlphaVersion(latest);
  if (!mine || !theirs) return "";
  for (let i = 0; i < 3; i += 1) {
    if (theirs.base[i] !== mine.base[i]) return theirs.base[i] > mine.base[i] ? latest : "";
  }
  return theirs.alpha > mine.alpha ? latest : "";
}

/** Prečíta najnovšiu alfu z webu. Chyba siete nie je chyba appky: vráti prázdny reťazec. */
export async function latestAlpha(current, { fetchImpl = fetch, platform = alphaPlatform() } = {}) {
  if (!platform || !parseAlphaVersion(current)) return "";
  try {
    const response = await fetchImpl(`${SITE}/api/alfa/verzia`, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
    if (!response.ok) return "";
    return newerAlpha(current, await response.json(), platform);
  } catch {
    return "";
  }
}
