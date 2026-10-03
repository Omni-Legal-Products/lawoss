/**
 * LAWOSS: pure decision logic for the Autogram teaser card (Integrations
 * settings). Kept free of React/Electron so it is testable without either —
 * `autogram-integration-card.tsx` is the only place that calls the desktop
 * bridge and renders this.
 *
 * Autogram (github.com/originalmagneto/autogram-macOS) is a separate, already
 * working native macOS app by the same author. LAWOSS only detects it and
 * offers to open it or point to the releases page — no other integration
 * exists yet.
 */

export const AUTOGRAM_RELEASES_URL = "https://github.com/originalmagneto/autogram-macOS/releases/latest";

/** The card is Electron-desktop + macOS only — Autogram itself is a macOS app. */
export function shouldShowAutogramCard(params: { desktopRuntime: boolean; isMac: boolean }): boolean {
  return params.desktopRuntime === true && params.isMac === true;
}

export type AutogramCardStatus = {
  installed: boolean;
  path: string | null;
};

export type AutogramCardAction = "open" | "download";

/** Installed -> offer to open it. Not (yet) found -> send the lawyer to the releases page. */
export function resolveAutogramCardAction(status: AutogramCardStatus | null | undefined): AutogramCardAction {
  return status?.installed === true ? "open" : "download";
}

export type AutogramStatusLine = "loading" | "error" | "installed" | "not_installed";

/**
 * The status line's i18n key depends on whether detection itself failed, not
 * just on what it found. A rejected `autogramStatus()` call (e.g. the
 * desktop bridge is unavailable) must read as "could not check", never as
 * "not installed" — those are different facts.
 */
export function resolveAutogramStatusLine(params: {
  isPending: boolean;
  isError: boolean;
  installed: boolean | undefined;
}): AutogramStatusLine {
  if (params.isPending) return "loading";
  if (params.isError) return "error";
  return params.installed === true ? "installed" : "not_installed";
}
