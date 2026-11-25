export const CHEVRON7_NAME = "Chevron7";

export const CHEVRON7_WEB_URL = "https://chevron7.slovensko.app";
export const CHEVRON7_INSTALL_URL = `${CHEVRON7_WEB_URL}/#stiahnut`;

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
