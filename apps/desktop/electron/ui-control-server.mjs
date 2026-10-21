// Local UI-control HTTP bridge: a loopback server exposing /snapshot,
// /actions, /execute, dispatched to the renderer's window.__legalworkControl
// surface via executeJavaScript. Consumed over HTTP by legalwork-ui-mcp.
// Extracted from main.mjs; state and lifecycle live in this factory
// (createRuntimeManager pattern).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// Serialized into the existing read-only snapshot evaluation. Return only
// finite DOM state and counts, never labels, input values, or document text.
function readUiReadiness() {
  const physicallyVisible = element => {
    if (!element.isConnected) return false;
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight;
  };
  const usable = element => {
    if (!physicallyVisible(element) || element.matches(':disabled') || element.readOnly || getComputedStyle(element).pointerEvents === 'none') return false;
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.hasAttribute('hidden') || ancestor.hasAttribute('inert') || ancestor.getAttribute('aria-hidden') === 'true' || ancestor.getAttribute('aria-disabled') === 'true') return false;
    }
    const rect = element.getBoundingClientRect();
    const x = (Math.max(0, rect.left) + Math.min(window.innerWidth, rect.right)) / 2;
    const y = (Math.max(0, rect.top) + Math.min(window.innerHeight, rect.bottom)) / 2;
    const hit = document.elementFromPoint(x, y);
    return hit === element || (hit !== null && element.contains(hit));
  };
  return {
    documentReadyState: ['loading', 'interactive', 'complete'].includes(document.readyState) ? document.readyState : 'unknown',
    // Accessibility isolation does not change whether boot content is painted.
    bootOverlayVisible: [...document.querySelectorAll('[data-legalwork-boot-overlay]')].some(physicallyVisible),
    interactiveControls: [...document.querySelectorAll('button, input:not([type="hidden"]), select, textarea, a[href], [role="button"], [role="textbox"], [role="combobox"], [contenteditable="true"]')].filter(usable).length,
  };
}

export function createUiControlServer({ appName, appIdentifier, getWindow, getUserDataDir }) {
  let uiControlServer = null;
  let uiControlDiscoveryPath = null;
  const uiControlToken = randomBytes(32).toString("hex");

  function sendJsonResponse(response, statusCode, payload) {
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(payload));
  }

  function readJsonRequestBody(request) {
    return new Promise((resolve, reject) => {
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 5 * 1024 * 1024) {
          reject(new Error("Request body too large"));
          request.destroy();
        }
      });
      request.on("end", () => {
        if (!raw.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error("Request body must be JSON"));
        }
      });
      request.on("error", reject);
    });
  }

  // Hashed before comparing so the check takes the same time whatever the
  // caller sends, and so mismatched lengths do not throw.
  function authorizedUiControlRequest(request) {
    const auth = String(request.headers.authorization ?? "");
    if (!auth) return false;
    return timingSafeEqual(
      createHash("sha256").update(auth).digest(),
      createHash("sha256").update(`Bearer ${uiControlToken}`).digest(),
    );
  }

  function jsonForJavaScript(value) {
    return JSON.stringify(JSON.stringify(value ?? {}));
  }

  async function evaluateLegalworkControl(expression, options = {}) {
    const win = await getWindow();
    if (options.focus === true) {
      win.show();
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    return win.webContents.executeJavaScript(expression, options.focus === true);
  }

  async function runLegalworkControlCommand(command, args = {}) {
    const argsJsonLiteral = jsonForJavaScript(args);
    if (command === "snapshot") {
      return evaluateLegalworkControl(`(async () => {
        const readReadiness = ${readUiReadiness.toString()};
        let readiness = readReadiness();
        if (window.__legalworkControl && readiness.documentReadyState === "complete"
          && !readiness.bootOverlayVisible && readiness.interactiveControls > 0) {
          // DOM visibility can precede presentation. Cross a frame boundary,
          // but leave stalled/background renderers unavailable within 250ms.
          const presented = await new Promise(resolve => {
            let frame;
            const finish = ready => { clearTimeout(timer); cancelAnimationFrame(frame); resolve(ready); };
            const timer = setTimeout(() => finish(false), 250);
            frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => finish(true)); });
          });
          readiness = readReadiness();
          if (!presented) return { ok: false, error: "Renderer presentation is not available yet.", readiness };
        }
        const control = window.__legalworkControl;
        if (!control) return { ok: false, error: "LegalWork control surface is not available yet.", readiness };
        return { ok: true, ...control.snapshot(), readiness };
      })()`);
    }
    if (command === "actions") {
      return evaluateLegalworkControl(`(async () => {
        const control = window.__legalworkControl;
        if (!control) return { ok: false, error: "LegalWork control surface is not available yet." };
        return { ok: true, actions: control.listActions() };
      })()`);
    }
    if (command === "execute") {
      // Agent edits run in the background. Raising the app requires an explicit request.
      return evaluateLegalworkControl(`(async () => {
        const control = window.__legalworkControl;
        const input = JSON.parse(${argsJsonLiteral});
        if (!control) return { ok: false, error: "LegalWork control surface is not available yet." };
        if (!input || typeof input.actionId !== "string" || !input.actionId.trim()) {
          return { ok: false, error: "Missing LegalWork actionId." };
        }
        return control.execute(input.actionId, input.args ?? {}, typeof input.callerSessionId === "string" ? input.callerSessionId : undefined);
      })()`, { focus: args.focus === true });
    }
    return { ok: false, error: `Unknown LegalWork control command: ${command}` };
  }

  async function start() {
    if (uiControlServer) return;
    uiControlServer = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (request.method === "GET" && url.pathname === "/health") {
          sendJsonResponse(response, 200, { ok: true, app: appName, version: 1 });
          return;
        }
        if (!authorizedUiControlRequest(request)) {
          sendJsonResponse(response, 401, { ok: false, error: "Unauthorized" });
          return;
        }
        if (request.method === "GET" && url.pathname === "/build-info") {
          const win = await getWindow();
          const build = await win.webContents.executeJavaScript(
            '(async () => window.__LEGALWORK_ELECTRON__.invokeDesktop("appBuildInfo"))()',
          );
          sendJsonResponse(response, 200, {ok: true, build,
            process: {pid: process.pid, userData: getUserDataDir(), executable: process.execPath},
            rendererUrl: win.webContents.getURL(),
            windowSourceId: typeof win.getMediaSourceId === "function" ? win.getMediaSourceId() : null});
          return;
        }
        if (request.method === "GET" && url.pathname === "/snapshot") {
          sendJsonResponse(response, 200, await runLegalworkControlCommand("snapshot"));
          return;
        }
        if (request.method === "GET" && url.pathname === "/actions") {
          sendJsonResponse(response, 200, await runLegalworkControlCommand("actions"));
          return;
        }
        if (request.method === "POST" && url.pathname === "/execute") {
          sendJsonResponse(response, 200, await runLegalworkControlCommand("execute", await readJsonRequestBody(request)));
          return;
        }
        sendJsonResponse(response, 404, { ok: false, error: "Not found" });
      } catch (error) {
        sendJsonResponse(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
    await new Promise((resolve, reject) => {
      uiControlServer.once("error", reject);
      uiControlServer.listen(0, "127.0.0.1", () => resolve(undefined));
    });
    const address = uiControlServer.address();
    const port = typeof address === "object" && address ? address.port : null;
    if (!port) throw new Error("Could not start LegalWork UI control bridge.");
    const discoveryPath = path.join(getUserDataDir(), "legalwork-ui-control.json");
    const temporaryPath = `${discoveryPath}.${randomBytes(16).toString("hex")}.tmp`;
    // Never put a fresh token in an existing inode: older releases created this
    // file with wider permissions. Publish a new owner-only file atomically.
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify({ version: 1, app: appName, identifier: appIdentifier, platform: process.platform, baseUrl: `http://127.0.0.1:${port}`, token: uiControlToken }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      // Windows readers and antivirus scans can briefly prevent replacement.
      // Retry the atomic rename, never write a new token into the old inode.
      for (let attempt = 0; ; attempt++) {
        try {
          await rename(temporaryPath, discoveryPath);
          break;
        } catch (error) {
          if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt === 5) throw error;
          await sleep(50 * (attempt + 1));
        }
      }
      uiControlDiscoveryPath = discoveryPath;
    } catch (error) {
      await new Promise((resolve) => uiControlServer.close(() => resolve(undefined)));
      uiControlServer = null;
      throw error;
    } finally {
      await rm(temporaryPath, { force: true });
    }
    // Make the discovery path available to child processes (server → managed OpenCode → plugin).
    process.env.LEGALWORK_UI_CONTROL_DISCOVERY = uiControlDiscoveryPath;
  }

  async function stop() {
    if (uiControlDiscoveryPath) {
      await rm(uiControlDiscoveryPath, { force: true }).catch(() => undefined);
      uiControlDiscoveryPath = null;
    }
    if (!uiControlServer) return;
    await new Promise((resolve) => uiControlServer.close(() => resolve(undefined)));
    uiControlServer = null;
  }

  return { start, stop };
}
