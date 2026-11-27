/**
 * LAWOSS: napojenie okna hlásenia (`lawoss-alpha-report.mjs`) na Electron. Závislosti prichádzajú z `main.mjs`,
 * aby sa dal modul testovať bez Electronu a zmena v `main.mjs` ostala malá.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectReportDiagnostics, createAlphaReportSession, createRedactor } from "./lawoss-alpha-report.mjs";
import { feedbackUrl } from "./lawoss-alpha-feedback.mjs";
import { buildSupportBundleText, collectTechnicalSupportBundle } from "./support-bundle.mjs";

/** Udalosť, ktorou menu Pomocník otvorí okno hlásenia v rendereri (preload ju prepošle ako `window` Event). */
export const ALPHA_REPORT_OPEN_EVENT = "lawoss:alpha-report:open";
const SCREENSHOT_MAX_WIDTH = 1600;
const PREVIEW_WIDTH = 480;
const DIAGNOSTICS_DAYS = 3;

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

/** Priečinky klientov a ich nadradené priečinky (kancelária); domovský priečinok a koreň disku nie. */
export function clientFolderRoots(paths, home = os.homedir()) {
  const roots = new Set();
  const homeKey = path.resolve(home);
  for (const value of paths) {
    const dir = String(value ?? "").trim();
    if (!dir) continue;
    roots.add(dir);
    const parent = path.dirname(dir);
    if (parent !== dir && path.resolve(parent) !== homeKey && path.dirname(parent) !== parent) roots.add(parent);
  }
  return [...roots];
}

/**
 * Len časti Electronu, ktoré okno hlásenia potrebuje (test ich nahradí).
 * @typedef {{ isEmpty: () => boolean, getSize: () => { width: number }, resize: (options: { width: number, quality?: "good" }) => ReportImage, toPNG: () => Buffer, toDataURL: () => string }} ReportImage
 * @typedef {{ isDestroyed: () => boolean, webContents: { capturePage: () => Promise<ReportImage> } }} ReportWindow
 */

/**
 * @param {{
 *   app: { getVersion: () => string, getName: () => string, isPackaged?: boolean, getPath: (name: any) => string },
 *   shell: { showItemInFolder: (file: string) => void, openExternal: (url: string) => Promise<unknown> },
 *   dialog: { showSaveDialog: (...args: any[]) => Promise<{ canceled: boolean, filePath?: string }> },
 *   BrowserWindow: { fromWebContents: (contents: any) => ReportWindow | null },
 *   runtimeManager: { legalworkServerInfo: () => Promise<any>, collectRuntimeDiagnostics: () => Promise<unknown> },
 *   listWorkspacePaths: () => Promise<string[]>,
 *   getMainWindow: () => ReportWindow | null,
 *   getLocale: () => string,
 *   saveTitle: () => string,
 * }} deps
 */
export function createAlphaReportHandlers(deps) {
  const { app, shell, dialog, BrowserWindow } = deps;
  const ownerWindow = (sender) => {
    const win = sender ? BrowserWindow.fromWebContents(sender) : null;
    const main = deps.getMainWindow();
    return win && !win.isDestroyed() ? win : main && !main.isDestroyed() ? main : null;
  };

  const redactor = async () => {
    const optional = (name) => { try { return app.getPath(name); } catch { return ""; } };
    // Domáci priečinok appky je v profile (`lawoss-home-workspace.mjs`), nie priečinok klienta.
    const userData = optional("userData");
    const insideProfile = (dir) => Boolean(userData) && !path.relative(userData, dir).startsWith("..") && !path.isAbsolute(path.relative(userData, dir));
    const workspaces = (await deps.listWorkspacePaths().catch(() => [])).map((dir) => String(dir ?? "").trim()).filter((dir) => dir && !insideProfile(dir));
    /** @type {Array<[string, string]>} */
    const profile = [[userData, "<profile>"], [optional("logs"), "<logs>"], [optional("temp"), "<temp>"], [process.resourcesPath ?? "", "<app>"]];
    return createRedactor({
      home: os.homedir(),
      clientRoots: clientFolderRoots(workspaces),
      clientNames: workspaces.map((dir) => path.basename(dir.replace(/[\\/]+$/, ""))),
      profile: profile.filter(([dir]) => dir),
    });
  };

  const session = createAlphaReportSession({
    async captureWindow(sender) {
      const win = ownerWindow(sender);
      if (!win) return null;
      const image = await win.webContents.capturePage();
      if (image.isEmpty()) return null;
      const { width } = image.getSize();
      const full = width > SCREENSHOT_MAX_WIDTH ? image.resize({ width: SCREENSHOT_MAX_WIDTH, quality: "good" }) : image;
      return { png: full.toPNG(), preview: image.resize({ width: Math.min(width, PREVIEW_WIDTH), quality: "good" }).toDataURL() };
    },
    async collectDiagnostics() {
      return collectReportDiagnostics({
        collectTechnical: async () => collectTechnicalSupportBundle({ app, runtimeManager: deps.runtimeManager, serverInfo: await deps.runtimeManager.legalworkServerInfo(), days: DIAGNOSTICS_DAYS }),
        collectBasic: () => buildSupportBundleText({ app, runtimeManager: deps.runtimeManager }),
        redactor: await redactor(),
      });
    },
    context: () => ({ version: app.getVersion(), locale: deps.getLocale() }),
    async saveFiles({ bundle, screenshot }) {
      let defaultDir;
      try { defaultDir = app.getPath("desktop"); } catch { defaultDir = os.homedir(); }
      const parent = deps.getMainWindow();
      const options = { title: deps.saveTitle(), defaultPath: path.join(defaultDir, `lawoss-hlasenie-${stamp()}`) };
      const { canceled, filePath } = parent && !parent.isDestroyed() ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
      if (canceled || !filePath) return null;
      // Priečinok s hlásením a snímkou, aby sa dal priložiť celý k e-mailu alebo webovému formuláru.
      const dir = filePath.replace(/\.json$/i, "");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(path.join(dir, "hlasenie.json"), bundle, { encoding: "utf8", mode: 0o600 });
      if (screenshot) writeFileSync(path.join(dir, "snimka-okna.png"), screenshot, { mode: 0o600 });
      shell.showItemInFolder(path.join(dir, "hlasenie.json"));
      return dir;
    },
  });

  return {
    lawossAlphaReportPrepare: async (event) => session.prepare(event?.sender),
    lawossAlphaReportPreview: async (_event, options) => session.preview(Number(options?.id)),
    lawossAlphaReportSubmit: async (_event, options) => session.submit(Number(options?.id), options?.report ?? {}),
    lawossAlphaReportSave: async (_event, options) => session.save(Number(options?.id), options?.report ?? {}),
    lawossAlphaReportDiscard: async (_event, options) => session.discard(Number(options?.id)),
    /** @returns {Promise<{ ok: true }>} */
    lawossAlphaReportOpenWeb: async () => {
      await shell.openExternal(feedbackUrl({ locale: deps.getLocale(), version: app.getVersion() }));
      return { ok: true };
    },
  };
}

/** Menu Pomocník: okno hlásenia v aktívnom okne appky; bez načítaného okna webový formulár. */
export function requestAlphaReport({ window, openWeb }) {
  if (window && !window.isDestroyed() && !window.webContents.isLoading()) {
    window.webContents.send(ALPHA_REPORT_OPEN_EVENT);
    return "window";
  }
  openWeb();
  return "web";
}
