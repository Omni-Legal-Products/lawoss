/**
 * LAWOSS: pure rules for the static Chevron7 card in Integrations.
 *
 * Chevron7 (github.com/originalmagneto/chevron7, EUPL 1.2) is a separate
 * native macOS app by the same author for qualified electronic signatures,
 * guaranteed conversion and its register. The card only announces a planned
 * integration: there is no connection and no call to Chevron7. The desktop app
 * may report whether Chevron7 is installed (bundle id `app.slovensko.chevron7`,
 * read from Info.plist), only to show "installed".
 */

export const CHEVRON7_NAME = "Chevron7";

export const CHEVRON7_WEB_URL = "https://chevron7.slovensko.app";

/**
 * Chevron7 runs only on macOS. On Windows and Linux the card stays hidden: a
 * lawyer there cannot install the app, so a "macOS only" teaser would be noise.
 * Showing the card does not need the desktop bridge, so it also shows in the
 * browser build on a Mac (without the installed state).
 */
export function shouldShowChevron7Card(params: { isMac: boolean }): boolean {
  return params.isMac === true;
}

/** The installed check needs the Electron bridge, so it runs only in the macOS desktop app. */
export function shouldCheckChevron7Installed(params: { desktopRuntime: boolean; isMac: boolean }): boolean {
  return params.desktopRuntime === true && params.isMac === true;
}
