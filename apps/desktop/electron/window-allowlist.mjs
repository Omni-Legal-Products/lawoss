/**
 * Which URLs an app window (main window, detached session windows) may show.
 *
 * Allowlist entries are either a scheme ("file:", "data:") or an origin
 * ("http://localhost:5173"). Origins are compared exactly, port included: the
 * old "any loopback host is trusted" check let a foreign dev server on another
 * localhost port render inside the main window (#47).
 */

/**
 * @param {string} url
 * @param {readonly string[]} allowlist
 * @returns {boolean}
 */
export function isAllowedNavigation(url, allowlist) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  return allowlist.some((entry) => (entry.endsWith(":") ? target.protocol === entry : target.origin === entry));
}

/**
 * Cancel every main-frame navigation outside the allowlist. `will-navigate`
 * and `will-redirect` do not fire for CDP `Page.navigate` (it behaves like
 * loadURL), so `did-start-navigation` is the backstop for agent automation
 * that picks the app window as its CDP target (upstream #2000).
 *
 * @param {import("node:events").EventEmitter & { stop(): void }} contents Electron WebContents
 * @param {readonly string[]} allowlist
 * @param {(url: string) => void} onBlocked
 */
export function guardNavigation(contents, allowlist, onBlocked) {
  /** @param {{ url: string; isMainFrame: boolean; preventDefault(): void }} event */
  const cancel = (event) => {
    if (!event.isMainFrame || isAllowedNavigation(event.url, allowlist)) return;
    event.preventDefault();
    onBlocked(event.url);
  };
  contents.on("will-navigate", cancel);
  contents.on("will-redirect", cancel);
  /** @param {{ url: string; isMainFrame: boolean; isSameDocument: boolean }} event */
  const stop = (event) => {
    if (!event.isMainFrame || event.isSameDocument || isAllowedNavigation(event.url, allowlist)) return;
    try {
      contents.stop();
    } catch {
      // best effort — onBlocked still gives the user a way back
    }
    onBlocked(event.url);
  };
  contents.on("did-start-navigation", stop);
}
