import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, open, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createUiControlServer } from "./ui-control-server.mjs";

function stubWindow() {
  return {
    show: () => {}, isMinimized: () => false, restore: () => {}, focus: () => {},
    webContents: { executeJavaScript: async () => ({ ok: true }) },
  };
}

test("Windows discovery survives a transient reader lock", { skip: process.platform !== "win32" }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "legalwork-ui-lock-"));
  const discoveryPath = path.join(root, "legalwork-ui-control.json");
  await writeFile(discoveryPath, JSON.stringify({ token: "old-token" }));
  const reader = await open(discoveryPath, "r");
  const bridge = createUiControlServer({
    appName: "test", appIdentifier: "test", getUserDataDir: () => root, getWindow: async () => stubWindow(),
  });
  t.after(async () => { await reader.close(); await bridge.stop(); await rm(root, { recursive: true, force: true }); });
  const starting = bridge.start();
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await reader.readFile("utf8"), JSON.stringify({ token: "old-token" }));
  await reader.close();
  await starting;
  const { token, baseUrl } = JSON.parse(await readFile(discoveryPath, "utf8"));
  assert.notEqual(token, "old-token");
  assert.equal((await fetch(`${baseUrl}/actions`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
  assert.deepEqual(await readdir(root), ["legalwork-ui-control.json"]);
});

test("the discovery file holding the token has owner-only POSIX permissions", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "legalwork-ui-perm-"));
  const bridge = createUiControlServer({
    appName: "test", appIdentifier: "test", getUserDataDir: () => root, getWindow: async () => stubWindow(),
  });
  t.after(async () => {
    await bridge.stop();
    await rm(root, { recursive: true, force: true });
  });

  await bridge.start();
  const discoveryPath = path.join(root, "legalwork-ui-control.json");
  const mode = (await stat(discoveryPath)).mode & 0o777;
  assert.equal(mode.toString(8), "600", "group and other must not be able to read the bearer token");
});

test("only the exact bearer token is accepted", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "legalwork-ui-auth-"));
  const bridge = createUiControlServer({
    appName: "test", appIdentifier: "test", getUserDataDir: () => root, getWindow: async () => stubWindow(),
  });
  t.after(async () => {
    await bridge.stop();
    await rm(root, { recursive: true, force: true });
  });

  await bridge.start();
  const { baseUrl, token } = JSON.parse(await readFile(path.join(root, "legalwork-ui-control.json"), "utf8"));
  const status = async (authorization) => (
    await fetch(`${baseUrl}/actions`, { headers: authorization ? { authorization } : {} })
  ).status;

  assert.equal(await status(`Bearer ${token}`), 200);
  assert.equal(await status(undefined), 401);
  assert.equal(await status(""), 401);
  // A correct prefix, a longer guess, and the bare token must all fail.
  assert.equal(await status(`Bearer ${token.slice(0, -1)}`), 401);
  assert.equal(await status(`Bearer ${token}x`), 401);
  assert.equal(await status(token), 401);
});

test("migration replaces a legacy discovery file without exposing the new token", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "legalwork-ui-migration-"));
  const discoveryPath = path.join(root, "legalwork-ui-control.json");
  const legacyContent = JSON.stringify({ token: "legacy-token", baseUrl: "http://127.0.0.1:1" });
  await writeFile(discoveryPath, legacyContent);
  await chmod(discoveryPath, 0o644);
  // Keep the old inode open, as another local user could before the upgrade.
  const legacyReader = await open(discoveryPath, "r");
  const legacyStat = await legacyReader.stat();
  let readerClosed = false;
  const bridge = createUiControlServer({
    appName: "test", appIdentifier: "test", getUserDataDir: () => root, getWindow: async () => stubWindow(),
  });
  t.after(async () => {
    if (!readerClosed) await legacyReader.close();
    await bridge.stop();
    await rm(root, { recursive: true, force: true });
  });

  if (process.platform === "win32") {
    // Windows refuses to replace a file held open by a reader. Fail closed:
    // leave the old token untouched, clean up, and allow a retry after release.
    await assert.rejects(bridge.start(), { code: "EPERM" });
    assert.equal(await legacyReader.readFile("utf8"), legacyContent);
    assert.deepEqual(await readdir(root), ["legalwork-ui-control.json"]);
    await legacyReader.close();
    readerClosed = true;
  }
  await bridge.start();
  const current = await stat(discoveryPath);
  if (process.platform !== "win32") assert.equal(current.mode & 0o777, 0o600);
  assert.notEqual(current.ino, legacyStat.ino);
  if (!readerClosed) assert.equal(await legacyReader.readFile("utf8"), legacyContent, "the readable old inode never receives the new token");
  const { token, baseUrl } = JSON.parse(await readFile(discoveryPath, "utf8"));
  assert.notEqual(token, "legacy-token");
  assert.equal((await fetch(`${baseUrl}/actions`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
  assert.equal((await fetch(`${baseUrl}/actions`, { headers: { authorization: "Bearer legacy-token" } })).status, 401);
  assert.deepEqual(await readdir(root), ["legalwork-ui-control.json"]);
});

test("publishing discovery replaces a legacy symlink without writing its target", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "legalwork-ui-symlink-"));
  const target = path.join(root, "old-token.json");
  await writeFile(target, "old-token");
  await symlink(target, path.join(root, "legalwork-ui-control.json"));
  const bridge = createUiControlServer({
    appName: "test", appIdentifier: "test", getUserDataDir: () => root, getWindow: async () => stubWindow(),
  });
  t.after(async () => { await bridge.stop(); await rm(root, { recursive: true, force: true }); });
  await bridge.start();
  assert.equal(await readFile(target, "utf8"), "old-token");
  assert.equal((await stat(path.join(root, "legalwork-ui-control.json"))).mode & 0o777, 0o600);
});

test("a failed discovery migration cleans up and can be retried", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "legalwork-ui-failure-"));
  const discoveryPath = path.join(root, "legalwork-ui-control.json");
  await mkdir(discoveryPath);
  const bridge = createUiControlServer({
    appName: "test", appIdentifier: "test", getUserDataDir: () => root, getWindow: async () => stubWindow(),
  });
  t.after(async () => { await bridge.stop(); await rm(root, { recursive: true, force: true }); });
  await assert.rejects(bridge.start());
  assert.deepEqual(await readdir(root), ["legalwork-ui-control.json"]);
  await rm(discoveryPath, { recursive: true });
  await bridge.start();
  const { token, baseUrl } = JSON.parse(await readFile(discoveryPath, "utf8"));
  assert.equal((await fetch(`${baseUrl}/actions`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
});

test("agent commands execute in a minimized window without stealing focus", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "legalwork-ui-focus-"));
  const calls = [];
  const previousDiscovery = process.env.LEGALWORK_UI_CONTROL_DISCOVERY;
  const bridge = createUiControlServer({
    appName: "test", appIdentifier: "test", getUserDataDir: () => root,
    getWindow: async () => ({
      show: () => calls.push("show"), isMinimized: () => true,
      restore: () => calls.push("restore"), focus: () => calls.push("focus"),
      webContents: { executeJavaScript: async (_expression, userGesture) => { calls.push({ userGesture }); return { ok: true }; } },
    }),
  });
  try {
    await bridge.start();
    const { baseUrl, token } = JSON.parse(await readFile(path.join(root, "legalwork-ui-control.json"), "utf8"));
    for (const actionId of ["documents.open", "office.agent_tool", "document.agent_tool", "markdown.agent_tool"]) {
      const response = await fetch(`${baseUrl}/execute`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ actionId }) });
      assert.equal(response.status, 200);
    }
    assert.deepEqual(calls, Array.from({ length: 4 }, () => ({ userGesture: false })));
    calls.length = 0;
    await fetch(`${baseUrl}/execute`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ actionId: "settings.panel.open", focus: true }) });
    assert.deepEqual(calls, ["show", "restore", "focus", { userGesture: true }]);
    assert.equal((await fetch(`${baseUrl}/execute`, { method: "POST", body: "{}" })).status, 401);
  } finally {
    await bridge.stop();
    if (previousDiscovery === undefined) delete process.env.LEGALWORK_UI_CONTROL_DISCOVERY;
    else process.env.LEGALWORK_UI_CONTROL_DISCOVERY = previousDiscovery;
    await rm(root, { recursive: true, force: true });
  }
});

test('build identity reads the live renderer IPC behind the existing bearer gate', async t => {
 const root=await mkdtemp(path.join(tmpdir(),'lawoss-build-bridge-'));const build={provenance:'embedded',version:'1.2.3',gitSha:'a'.repeat(40)};let expression='';
 const win={...stubWindow(),webContents:{executeJavaScript:async code=>{expression=code;return build;},getURL:()=> 'file:///fixture/app-dist/index.html'}};
 const bridge=createUiControlServer({appName:'test',appIdentifier:'test',getUserDataDir:()=>root,getWindow:async()=>win});
 t.after(async()=>{await bridge.stop();await rm(root,{recursive:true,force:true});});await bridge.start();
 const {baseUrl,token}=JSON.parse(await readFile(path.join(root,'legalwork-ui-control.json'),'utf8'));
 assert.equal((await fetch(`${baseUrl}/build-info`)).status,401);
 const response=await fetch(`${baseUrl}/build-info`,{headers:{authorization:`Bearer ${token}`}});assert.equal(response.status,200);const result=await response.json();assert.deepEqual(result.build,build);assert.equal(result.process.pid,process.pid);assert.equal(result.process.userData,root);assert.match(expression,/invokeDesktop\("appBuildInfo"\)/);assert.equal(result.rendererUrl,'file:///fixture/app-dist/index.html');
});

// Execute the actual shipping snapshot expression against a DOM boundary
// fixture. These are probe tests, not native Electron acceptance evidence.
function readinessElement({ attributes = {}, style = {}, parentElement = null, disabled = false, readOnly = false, top = 100 } = {}) {
  const element = {
    isConnected: true, parentElement, disabled, readOnly,
    hasAttribute: name => Object.hasOwn(attributes, name),
    getAttribute: name => attributes[name] ?? null,
    matches: selector => selector === ':disabled' && (disabled || parentElement?.disabled === true),
    getBoundingClientRect: () => ({ left: 10, top, right: 210, bottom: top + 30, width: 200, height: 30 }),
    contains: other => other === element,
    computedStyle: { display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto', ...style },
  };
  for (const field of ['textContent', 'innerText', 'value']) Object.defineProperty(element, field, { get() { throw new Error('Readiness must not inspect user content'); } });
  return element;
}

async function shippingSnapshot(t, { readyState = 'complete', overlays = [], controls = [], occluded = false, control = true,
  onAnimationFrame = (_frame = 0) => {}, requestFrame = (callback = () => {}) => setImmediate(callback), cancelFrame = clearImmediate } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'lawoss-ui-readiness-'));
  const previousDiscovery = process.env.LEGALWORK_UI_CONTROL_DISCOVERY;
  const document = {
    readyState,
    querySelectorAll: selector => selector.includes('data-legalwork-boot-overlay') ? overlays : controls,
    elementFromPoint: (x, y) => occluded ? {} : controls.find(element => { const r = element.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }) ?? null,
  };
  let frame = 0;
  const bridge = createUiControlServer({ appName: 'test', appIdentifier: 'test', getUserDataDir: () => root,
    getWindow: async () => ({ ...stubWindow(), webContents: { executeJavaScript: async expression => runInNewContext(expression, {
      document, window: { innerWidth: 1000, innerHeight: 800,
        __legalworkControl: control ? { snapshot: () => ({ route: '/welcome', readiness: { private: 'forged' } }) } : undefined },
      getComputedStyle: element => element.computedStyle,
      requestAnimationFrame: callback => requestFrame(() => { onAnimationFrame(++frame); callback(frame); }),
      cancelAnimationFrame: cancelFrame, setTimeout, clearTimeout,
    }) } }),
  });
  t.after(async () => {
    await bridge.stop();
    if (previousDiscovery === undefined) delete process.env.LEGALWORK_UI_CONTROL_DISCOVERY;
    else process.env.LEGALWORK_UI_CONTROL_DISCOVERY = previousDiscovery;
    await rm(root, { recursive: true, force: true });
  });
  await bridge.start();
  const { baseUrl, token } = JSON.parse(await readFile(path.join(root, 'legalwork-ui-control.json'), 'utf8'));
  assert.equal((await fetch(`${baseUrl}/snapshot`)).status, 401);
  const response = await fetch(`${baseUrl}/snapshot`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) });
  assert.equal(response.status, 200);
  return response.json();
}

test('shipping snapshot distinguishes a boot overlay from an interactive application', async t => {
  const snapshot = await shippingSnapshot(t, { overlays: [readinessElement()], controls: [readinessElement()] });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.route, '/welcome');
  assert.deepEqual(snapshot.readiness, { documentReadyState: 'complete', bootOverlayVisible: true, interactiveControls: 1 });
});

for (const attributes of [{ 'aria-hidden': 'true' }, { inert: '' }]) {
  test(`bootOverlayVisible remains true for a physically visible ${Object.keys(attributes)[0]} marker`, async t => {
    const snapshot = await shippingSnapshot(t, { overlays: [readinessElement({ attributes })], controls: [readinessElement()] });
    assert.deepEqual(snapshot.readiness, { documentReadyState: 'complete', bootOverlayVisible: true, interactiveControls: 1 });
  });
}

test('shipping snapshot with no usable controls cannot imply readiness', async t => {
  const snapshot = await shippingSnapshot(t);
  assert.deepEqual(snapshot.readiness, { documentReadyState: 'complete', bootOverlayVisible: false, interactiveControls: 0 });
});

test('shipping snapshot reports usable onboarding inputs without reading their content', async t => {
  const snapshot = await shippingSnapshot(t, { controls: [readinessElement()] });
  assert.deepEqual(snapshot.readiness, { documentReadyState: 'complete', bootOverlayVisible: false, interactiveControls: 1 });
  assert.doesNotMatch(JSON.stringify(snapshot), /forged|private/);
});

test('shipping snapshot recomputes readiness after renderer frame turns instead of returning prepaint DOM state', async t => {
  const overlay = readinessElement({ style: { opacity: '0' } });
  const snapshot = await shippingSnapshot(t, { controls: [readinessElement()], overlays: [overlay],
    onAnimationFrame: frame => { if (frame === 2) overlay.computedStyle.opacity = '1'; } });
  assert.equal(snapshot.readiness.bootOverlayVisible, true);
});

test('shipping snapshot stays unavailable when renderer presentation does not advance', async t => {
  const snapshot = await shippingSnapshot(t, { controls: [readinessElement()], requestFrame: () => setImmediate(() => {}) });
  assert.equal(snapshot.ok, false);
  assert.match(snapshot.error, /presentation|frame/i);
});

test('readiness excludes hidden, disabled, readonly, inert and CSS-hidden controls and ancestors', async t => {
  const controls = [
    readinessElement({ attributes: { hidden: '' } }),
    readinessElement({ attributes: { 'aria-hidden': 'true' } }),
    readinessElement({ attributes: { inert: '' } }),
    readinessElement({ disabled: true }),
    readinessElement({ readOnly: true }),
    readinessElement({ attributes: { 'aria-disabled': 'true' } }),
    readinessElement({ style: { display: 'none' } }),
    readinessElement({ style: { visibility: 'hidden' } }),
    readinessElement({ style: { opacity: '0' } }),
    readinessElement({ style: { pointerEvents: 'none' } }),
    readinessElement({ parentElement: readinessElement({ attributes: { hidden: '' } }) }),
    readinessElement({ parentElement: readinessElement({ style: { opacity: '0' } }) }),
  ];
  const snapshot = await shippingSnapshot(t, { controls });
  assert.equal(snapshot.readiness.interactiveControls, 0);
});

test('readiness excludes offscreen and occluded controls and a faded boot overlay', async t => {
  const snapshot = await shippingSnapshot(t, { controls: [readinessElement({ top: 900 }), readinessElement()],
    overlays: [readinessElement({ style: { opacity: '0' } })], occluded: true });
  assert.deepEqual(snapshot.readiness, { documentReadyState: 'complete', bootOverlayVisible: false, interactiveControls: 0 });
});

test('readiness retains document loading state even if a control is already available', async t => {
  const snapshot = await shippingSnapshot(t, { readyState: 'loading', controls: [readinessElement()] });
  assert.deepEqual(snapshot.readiness, { documentReadyState: 'loading', bootOverlayVisible: false, interactiveControls: 1 });
});

test('missing shipping control stays unavailable while exposing only finite DOM readiness', async t => {
  const snapshot = await shippingSnapshot(t, { control: false });
  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.error, 'LegalWork control surface is not available yet.');
  assert.deepEqual(snapshot.readiness, { documentReadyState: 'complete', bootOverlayVisible: false, interactiveControls: 0 });
});

test('unknown document state stays unknown and cannot export arbitrary state text', async t => {
  const snapshot = await shippingSnapshot(t, { readyState: 'private-document-content' });
  assert.deepEqual(snapshot.readiness, { documentReadyState: 'unknown', bootOverlayVisible: false, interactiveControls: 0 });
  assert.doesNotMatch(JSON.stringify(snapshot), /private-document-content/);
});
