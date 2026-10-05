/**
 * LAWOSS: jediné miesto pre značku a odkazy na releasy forku.
 *
 * Rozhodnutie MČ 5. 10. 2026 (M3): appka sa volá LAWOSS a schopnosť upstream syncu
 * ostáva. Upstream súbory preto nenesú vlastné hodnoty, ale berú ich odtiaľto
 * (jeden import, jeden riadok). Miesta, ktoré importovať nevedia
 * (`electron-builder.yml`, `index.html`, predvolené hodnoty v `shell-config.tsx`),
 * stráži `lawoss/scripts/check-branding.mjs`.
 *
 * Desktop: zdroje Electronu sa balia bez bundlera a `files:` v `electron-builder.yml`
 * nesiaha mimo `apps/desktop`, preto `apps/desktop/electron/lawoss-branding.mjs`
 * je bajtovo zhodná kópia tohto súboru. Po zmene ju obnov príkazom
 * `node lawoss/scripts/check-branding.mjs --write`; stráž rozdiel nepustí.
 *
 * Značka nie je identita na disku: `APP_IDENTIFIER` (`com.eigenweltlabs.legalwork`),
 * `appId` a schéma `legalwork://` sa nemenia, lebo z nich sa odvodzuje priečinok
 * s dátami, kľúčenka a doterajšie odkazy. Tie hodnoty drží stráž, nie tento súbor.
 *
 * Súbor nemá importy ani závislosti: číta ho appka (Vite), server aj Electron.
 */

/** Názov aplikácie, ktorý vidí advokát. */
export const BRAND_NAME = "LAWOSS";

/** Názov upstream produktu v zdedených textoch; `t()` ho nahrádza za `BRAND_NAME`. */
export const UPSTREAM_BRAND_NAME = "LegalWork";

/**
 * Názov procesu (`app.setName`) a menu. Vývojový režim beží vedľa inštalovanej appky.
 * @param {boolean} [isDevMode]
 */
export function brandAppName(isDevMode = false) {
  return isDevMode ? `${BRAND_NAME} - Dev` : BRAND_NAME;
}

/** Repozitár, z ktorého LAWOSS vychádza a aktualizuje sa. */
export const FORK_REPOSITORY = "Omni-Legal-Products/lawoss";

const FORK_URL = `https://github.com/${FORK_REPOSITORY}`;

/**
 * Prehľad releasov. Zámerne nie `/releases/latest`: tam môže byť vo forku
 * release orchestrátorového sidecaru, nie aplikácie.
 */
export const FORK_RELEASES_URL = `${FORK_URL}/releases`;

/** Základ adries assetov podľa tagu (`<základ>/<tag>/<súbor>`). */
export const FORK_RELEASE_DOWNLOAD_BASE_URL = `${FORK_URL}/releases/download`;

/** GitHub API pre zoznam releasov aplikácie. */
export const FORK_RELEASES_API_URL = `https://api.github.com/repos/${FORK_REPOSITORY}/releases`;

/**
 * Priebežné alfa tagy, na ktoré alfa workflowy forku nahrávajú manifest updatera
 * (`latest-mac.yml`, `latest.yml`) a inštalátory.
 */
export const ALPHA_RELEASE_TAGS = Object.freeze({ macos: "alpha-macos-latest", windows: "alpha-windows-latest" });

/**
 * Adresa assetov priebežného alfa tagu.
 * @param {"macos" | "windows"} platform
 */
export function alphaReleaseDownloadUrl(platform) {
  return `${FORK_RELEASE_DOWNLOAD_BASE_URL}/${ALPHA_RELEASE_TAGS[platform]}`;
}

/**
 * Stránka priebežného alfa tagu.
 * @param {"macos" | "windows"} platform
 */
export function alphaReleasePageUrl(platform) {
  return `${FORK_URL}/releases/tag/${ALPHA_RELEASE_TAGS[platform]}`;
}
