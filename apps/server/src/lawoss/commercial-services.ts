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
