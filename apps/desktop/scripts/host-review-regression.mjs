import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { app, BrowserWindow, ipcMain, screen } from "electron";
import { createHostApprovalHandler } from "../electron/host-approvals.mjs";
import { createContextReview } from "../electron/host-context-review.mjs";

const userData = process.env.LEGALWORK_HOST_REVIEW_USERDATA;
if (!userData) throw new Error("Use the owned run-host-review-regression.mjs launcher");
app.setPath("userData", userData);
app.on("window-all-closed", () => {});
const watchdog = setTimeout(() => {console.error("Owned host review regression timed out"); app.exit(1);}, 45000);
let parent;
const observations = [];
app.whenReady().then(async () => {
try {
  parent = new BrowserWindow({show: false, width: 800, height: 600, webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false}});
  await parent.loadURL("data:text/html,<html><body>Owned host review fixture</body></html>");
  const show = createContextReview({BrowserWindow, ipcMain, screen});
  const detail = "EXACT-START\n" + '<script>globalThis.unsafe=true</script>\n<img src="https://invalid.test/">\n'.repeat(180) + "EXACT-END";
  const handler = createHostApprovalHandler({getWindow: () => parent, showContextReview: show, showMessageBox: async () => assert.fail("unbounded native dialog")});
  const run = async action => {
    const controller = new AbortController();
    const decision = handler({workspaceId: "synthetic", action: "ai.public.synthetic", actor: {type: "host"}, summary: "Synthetic full context", description: detail, paths: []}, controller.signal);
    let review, state;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      review = BrowserWindow.getAllWindows().find(window => window !== parent);
      if (review && !review.isDestroyed()) {
        state = await review.webContents.executeJavaScript(`(() => {
          const text = document.getElementById('context'), deny = document.getElementById('deny'), allow = document.getElementById('allow');
          if (!text?.textContent || deny.disabled) return null;
          const bounds = allow.getBoundingClientRect();
          return {text: text.textContent, scrollHeight: text.scrollHeight, clientHeight: text.clientHeight, focus: document.activeElement.id,
            actionsVisible: bounds.top >= 0 && bounds.bottom <= innerHeight, injectedNodes: document.querySelectorAll('script,img,iframe').length,
            requireType: typeof require, appBridge: typeof globalThis.desktopBridge, unsafe: Boolean(globalThis.unsafe)};
        })()`);
        if (state) break;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(state, "Actual isolated preload must populate context before decision");
    assert.ok(state.text.includes(detail));
    assert.ok(state.scrollHeight > state.clientHeight, "Long exact context must scroll within bounded window");
    assert.equal(state.actionsVisible, true); assert.equal(state.focus, "deny"); assert.equal(state.injectedNodes, 0);
    assert.equal(state.requireType, "undefined"); assert.equal(state.appBridge, "undefined"); assert.equal(state.unsafe, false);
    const prefs = review.webContents.getLastWebPreferences();
    assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false);
    const area = screen.getDisplayMatching(parent.getBounds()).workArea, bounds = review.getBounds();
    assert.ok(bounds.width <= area.width && bounds.height <= area.height);
    assert.ok(bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height, JSON.stringify({bounds, area}));
    const count = BrowserWindow.getAllWindows().length;
    await review.webContents.executeJavaScript("window.open('https://invalid.test/')");
    assert.equal(BrowserWindow.getAllWindows().length, count);
    const textHash = createHash("sha256").update(state.text).digest("hex");
    if (action === "allow") await review.webContents.executeJavaScript("document.getElementById('allow').click()");
    if (action === "deny") await review.webContents.executeJavaScript("document.getElementById('deny').click()");
    if (action === "escape") review.webContents.sendInputEvent({type: "keyDown", keyCode: "Escape"});
    if (action === "abort") controller.abort();
    if (action === "close") review.close();
    if (action === "navigation") {
      await review.webContents.executeJavaScript("location.href='https://invalid.test/'").catch(() => {});
    }
    assert.equal(await decision, action === "allow" ? "allow" : "deny");
    assert.equal(review.isDestroyed(), true);
    observations.push({action, decision: action === "allow" ? "allow" : "deny", bounds, textBytes: state.text.length, textHash, scroll: true, actionsVisible: true, sandbox: true});
  };
  for (const action of ["allow", "deny", "escape", "abort", "close", "navigation"]) await run(action);
  console.log(JSON.stringify({ok: true, electron: process.versions.electron, observations}));
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  if (process.exitCode) app.exit(process.exitCode);
  else app.quit();
}
}).catch(error => {console.error(error); app.exit(1);});
