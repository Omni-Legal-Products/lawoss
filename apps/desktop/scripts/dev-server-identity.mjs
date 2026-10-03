import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Who answers on the dev port.
 *
 * `electron-dev.mjs` used to accept any Vite server there (`/@vite/client` is
 * served by every Vite app) and hand it to Electron as the start URL, so a
 * foreign project on the same port rendered inside the main window (#47).
 * Upstream's Vite config already serves `/__legalwork_dev_server_id` with the
 * absolute `apps/app` path of the checkout it runs from; only a server that
 * reports *this* checkout counts as ours.
 */

export const DEV_SERVER_ID_PATH = "/__legalwork_dev_server_id";

/** @param {string} value */
function canonicalPath(value) {
  try {
    return realpathSync.native(value);
  } catch {
    return resolve(value);
  }
}

/**
 * @param {string} url Origin to probe, e.g. `http://127.0.0.1:5173`
 * @param {{ appRoot: string; fetchImpl?: (url: string) => Promise<Response> }} options
 *   `appRoot` is this checkout's `apps/app`; `fetchImpl` is injectable for tests.
 * @returns {Promise<{ status: "ours" | "foreign" | "down"; reportedAppRoot?: string }>}
 *   `ours` — our Vite; `foreign` — something else answers (any HTTP server,
 *   another Vite, another LegalWork checkout); `down` — nothing answered.
 */
export async function identifyDevServer(url, { appRoot, fetchImpl = fetch }) {
  let response;
  try {
    response = await fetchImpl(`${url}${DEV_SERVER_ID_PATH}`);
  } catch {
    return { status: "down" };
  }
  let body;
  try {
    body = await response.json();
  } catch {
    // Vite's SPA fallback answers unknown paths with index.html — a foreign Vite.
    return { status: "foreign" };
  }
  const reportedAppRoot =
    typeof body === "object" && body !== null && "appRoot" in body && typeof body.appRoot === "string"
      ? body.appRoot
      : undefined;
  if (response.ok && reportedAppRoot && canonicalPath(reportedAppRoot) === canonicalPath(appRoot)) {
    return { status: "ours", reportedAppRoot };
  }
  return reportedAppRoot ? { status: "foreign", reportedAppRoot } : { status: "foreign" };
}

/**
 * @param {{ url: string; port: number; reportedAppRoot?: string }} params
 * @returns {string}
 */
export function describeForeignDevServer({ url, port, reportedAppRoot }) {
  const who = reportedAppRoot
    ? `a LegalWork/LAWOSS dev server from another checkout (${reportedAppRoot})`
    : "a server that is not this checkout's Vite dev server";
  return [
    `[electron-dev] Port ${port} (${url}) is held by ${who}.`,
    "[electron-dev] Refusing to load it into the app window. Stop it, or run LAWOSS on another port:",
    `[electron-dev]   PORT=${port + 1} pnpm dev`,
  ].join("\n");
}
