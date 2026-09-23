import { pathToFileURL } from "node:url";

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
  return allowlist.some((entry) => {
    if (entry.startsWith("file://")) return target.protocol === "file:" && target.href.startsWith(entry);
    return entry.endsWith(":") ? target.protocol === entry : target.origin === entry;
  });
}

/**
 * Allowlist entry for one directory on disk (the app's own bundle), so app
 * windows only show the app's own documents. `new URL` resolves `..`, so the
 * prefix check stays inside the directory.
 *
 * @param {string} dir
 * @returns {string}
 */
export function fileDirectoryEntry(dir) {
  const href = pathToFileURL(dir).href;
  return href.endsWith("/") ? href : `${href}/`;
}

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Only these schemes go to `shell.openExternal`; anything else would be
 * handed to whatever handler the OS has registered for it.
 *
 * @param {unknown} url
 * @returns {boolean}
 */
export function isSafeExternalUrl(url) {
  if (typeof url !== "string") return false;
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

// ponytail: allowlist prípon; rozšíriť, keď advokát narazí na ďalší bežný formát
const DOCUMENT_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "odt", "rtf", "txt", "md", "xls", "xlsx", "ods", "csv",
  "ppt", "pptx", "odp", "png", "jpg", "jpeg", "gif", "heic", "tif", "tiff",
  "eml", "msg", "zfo", "xml", "json", "html", "htm", "mp3", "m4a", "wav",
]);

/**
 * `shell.openPath` launches executables and app bundles, so a `file://` link
 * in rendered content only opens known document types; anything else is
 * revealed in Finder/Explorer instead.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export function isOpenableDocument(filePath) {
  const name = filePath.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 && DOCUMENT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/**
 * Allowlist entry for the app's own document, or nothing at all. `file:`,
 * `data:`, `about:` and `javascript:` all report the opaque origin "null", so a
 * start URL that is not http(s) must NOT become an entry: "null" would then
 * match every other opaque-origin URL and `window.open("javascript:…")` would
 * get a window with our preload. A malformed start URL yields nothing rather
 * than throwing — the app must still start and fail visibly at `loadURL`.
 *
 * @param {string | undefined} url
 * @returns {string[]}
 */
export function originAllowlistEntry(url) {
  if (!url) return [];
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return [];
  }
  return origin && origin !== "null" ? [origin] : [];
}

/**
 * What may be written to the log about a blocked URL: scheme, host and path.
 * Query and fragment stay out — a blocked navigation can carry a magic link,
 * an OAuth code or a matter identifier, and the log is not the place for them.
 *
 * @param {string} url
 * @returns {string}
 */
export function describeBlockedUrl(url) {
  try {
    const target = new URL(url);
    return target.origin === "null" ? `${target.protocol}…` : `${target.origin}${target.pathname}`;
  } catch {
    return "(neplatná adresa)";
  }
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
