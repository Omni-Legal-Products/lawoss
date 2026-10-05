/**
 * LAWOSS: serverové poistky pre firemné služby dodávateľa upstreamu (Eigenwelt).
 *
 * Appka tieto plochy skrýva v `apps/app/src/lawoss/feature-flags.ts`, ale server
 * ich musí vypnúť sám: keby sa používateľ do Eigenwelt predsa prihlásil, lokálne
 * úlohy, poznámky, prílohy a prístupy k úložiskám by odišli na ich platformu.
 *
 * Upstream testy zapínajú pôvodné správanie cez `LAWOSS_EIGENWELT_FIRM_SERVICES=1`
 * (`apps/server/test-preload-lawoss.ts`), aby dál overovali upstream logiku.
 */
export const EIGENWELT_FIRM_SERVICES_ENV = "LAWOSS_EIGENWELT_FIRM_SERVICES";

/** Synchronizácia úloh s firmou a tímové pripojenia úložísk cez Eigenwelt. */
export const eigenweltFirmServicesEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env[EIGENWELT_FIRM_SERVICES_ENV] === "1";

/**
 * OAuth poskytovatelia úložísk, ktorých tokeny idú cez broker Eigenwelt. Box je
 * povolený len s vlastným brokerom (`LEGALWORK_STORAGE_BOX_OAUTH_URL`).
 */
export const storageOAuthProviderAllowed = (id: string, env: NodeJS.ProcessEnv = process.env): boolean =>
  id !== "box" || Boolean(env.LEGALWORK_STORAGE_BOX_OAUTH_URL?.trim());

/**
 * Účet Eigenwelt a jeho platené modely (rozhodnutie MČ 5. 10. 2026: Eigenwelt nesmie
 * byť aktívne pripojený na appku). Bez `LAWOSS_EIGENWELT_ACCOUNT=1` server:
 * - číta uložené pripojenie účtu ako prázdne (`readEigenweltConnection`), takže sa
 *   neobnovujú tokeny, nesťahujú entitlements, hub ani intake;
 * - nečíta cache plateného manifestu (`readCachedEigenweltPaidManifest`), takže sa
 *   pri štarte neobnovuje a engine nedostane poskytovateľa `eigenwelt`;
 * - nesťahuje manifest modelov (`fetchEigenweltManifest`);
 * - poskytovateľa `eigenwelt` vypne v engine (`disabled_providers`), aj keby bol
 *   uložený v starej konfigurácii spisu.
 * Platí aj pre stav, ktorý zostal z inštalácie LegalWorku v `~/.config/legalwork`.
 * Upstream testy ho zapínajú v `apps/server/test-preload-lawoss.ts`.
 */
export const EIGENWELT_ACCOUNT_ENV = "LAWOSS_EIGENWELT_ACCOUNT";

export const eigenweltAccountEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env[EIGENWELT_ACCOUNT_ENV] === "1";

export const EIGENWELT_ACCOUNT_DISABLED_MESSAGE = "Eigenwelt is not available in LAWOSS.";
