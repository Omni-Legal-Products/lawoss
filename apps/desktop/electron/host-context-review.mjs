import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

// Fixed host-owned document: request contents are delivered only as textContent
// by the isolated preload. No application bridge, page script or remote resource.
const documentUrl = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'"><title>Review request</title><style>
*{box-sizing:border-box}html,body{height:100%;margin:0}body{font:14px system-ui,sans-serif;background:#fff;color:#161616;padding:20px;display:flex;flex-direction:column;gap:12px;overflow:hidden}h1{font-size:20px;margin:0}p{margin:0}header,footer{flex:none}header{display:grid;gap:8px}pre{flex:1;min-height:0;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #aaa;border-radius:6px;padding:12px;margin:0;font:12px/1.5 ui-monospace,monospace;user-select:text}footer{display:flex;justify-content:flex-end;gap:12px;padding-top:4px}button{font:inherit;padding:8px 18px;min-height:38px}button:focus-visible,pre:focus-visible{outline:3px solid #185abc;outline-offset:2px}
</style></head><body><header><h1 id="heading">Review request</h1><p id="message"></p><p>Review the complete context below. This decision applies only to this request.</p></header><pre id="context" tabindex="0" role="region" aria-label="Complete request context"></pre><footer><button id="deny" type="button" disabled autofocus>Deny</button><button id="allow" type="button" disabled>Allow this request</button></footer></body></html>`)}`;

/** Main-process authority over one disposable, sender/request-bound review. */
export function createContextReview({ BrowserWindow, ipcMain, screen }) {
  return (parent, options) => new Promise(resolve => {
    if (options.signal.aborted || parent.isDestroyed()) return resolve({response: 0});
    const reviewId = randomUUID();
    const work = screen.getDisplayMatching(parent.getBounds()).workAreaSize;
    const width = Math.min(900, Math.max(1, work.width - 32));
    const height = Math.min(760, Math.max(1, work.height - 48));
    const window = new BrowserWindow({parent, modal: true, show: false, title: options.title,
      width, height, minWidth: Math.min(500, width), minHeight: Math.min(350, height), maxWidth: width, maxHeight: height,
      minimizable: false, maximizable: false, fullscreenable: false, autoHideMenuBar: true,
      webPreferences: {preload: fileURLToPath(new URL("./host-review-preload.cjs", import.meta.url)),
        additionalArguments: [`--lawoss-review-id=${reviewId}`], partition: `lawoss-host-review-${reviewId}`,
        sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false,
        devTools: false, webSecurity: true, navigateOnDragDrop: false, spellcheck: false}});
    const contents = window.webContents;
    const payload = Object.freeze({reviewId, title: options.title, message: options.message, detail: options.detail});
    let settled = false, ready = false;
    const ownSender = event => event.sender === contents && event.senderFrame === contents.mainFrame
      && !window.isDestroyed() && contents.getURL() === documentUrl;
    const finish = response => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener("lawoss:host-review:ready", onReady);
      ipcMain.removeListener("lawoss:host-review:decision", onDecision);
      options.signal.removeEventListener("abort", deny);
      parent.removeListener("closed", deny);
      if (!window.isDestroyed()) window.destroy();
      resolve({response});
    };
    const deny = () => finish(0);
    const onReady = (event, id) => {
      if (settled || ready || id !== reviewId || !ownSender(event)) return;
      ready = true; contents.send("lawoss:host-review:payload", payload);
    };
    const onDecision = (event, id, decision) => {
      if (settled || !ready || id !== reviewId || !ownSender(event)) return;
      finish(decision === "allow" && !options.signal.aborted && !parent.isDestroyed() ? 1 : 0);
    };
    const blockNavigation = event => {event.preventDefault(); deny();};
    contents.setWindowOpenHandler(() => ({action: "deny"}));
    contents.on("will-navigate", blockNavigation);
    contents.on("will-redirect", blockNavigation);
    contents.on("will-attach-webview", blockNavigation);
    contents.on("did-start-navigation", (_event, url, _inPlace, mainFrame) => {if (mainFrame && url !== documentUrl) deny();});
    contents.on("before-input-event", (event, input) => {if (input.type === "keyDown" && input.key === "Escape") {event.preventDefault(); deny();}});
    contents.on("render-process-gone", deny);
    contents.on("did-fail-load", deny);
    contents.session?.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    contents.session?.setPermissionCheckHandler(() => false);
    window.setMenu?.(null);
    window.once("closed", deny);
    parent.once("closed", deny);
    options.signal.addEventListener("abort", deny, {once: true});
    ipcMain.on("lawoss:host-review:ready", onReady);
    ipcMain.on("lawoss:host-review:decision", onDecision);
    // Catch an abort that happened during construction before listener admission.
    if (options.signal.aborted || parent.isDestroyed()) return deny();
    try {window.loadURL(documentUrl).then(() => {if (!settled) window.show();}).catch(deny);} catch {deny();}
  });
}
