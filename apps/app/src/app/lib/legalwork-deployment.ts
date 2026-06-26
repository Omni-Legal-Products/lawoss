export const LEGALWORK_DEPLOYMENT_ENV_VAR = "VITE_LEGALWORK_DEPLOYMENT";

export type LegalWorkDeployment = "desktop" | "web";

function normalizeDeployment(value: string | undefined): LegalWorkDeployment {
  const normalized = value?.trim().toLowerCase();
  return normalized === "web" ? "web" : "desktop";
}

export function getLegalWorkDeployment(): LegalWorkDeployment {
  const envValue =
    typeof import.meta !== "undefined" && typeof import.meta.env?.VITE_LEGALWORK_DEPLOYMENT === "string"
      ? import.meta.env.VITE_LEGALWORK_DEPLOYMENT
      : undefined;

  return normalizeDeployment(envValue);
}

export function isWebDeployment(): boolean {
  return getLegalWorkDeployment() === "web";
}

export function isDesktopDeployment(): boolean {
  return getLegalWorkDeployment() === "desktop";
}
