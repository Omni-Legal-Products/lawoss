import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { createContextReview } from "./host-context-review.mjs";

function fixture() {
  const ipcMain = new EventEmitter(), windows = [];
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false;
      this.webContents = Object.assign(new EventEmitter(), {mainFrame: {}, getURL: () => this.url, send: (...args) => {this.sent = args;}, setWindowOpenHandler: handler => {this.open = handler;}});
      windows.push(this);
    }
    async loadURL(url) {this.url = url; this.webContents.mainFrame.url = url;}
    show() {this.shown = true;}
    isDestroyed() {return this.destroyed;}
    destroy() {this.destroyed = true; this.emit("closed");}
  }
  const parent = Object.assign(new EventEmitter(), {isDestroyed: () => false, getBounds: () => ({x: 0, y: 0, width: 800, height: 600})});
  const show = createContextReview({BrowserWindow: Window, ipcMain, screen: {getDisplayMatching: () => ({workAreaSize: {width: 800, height: 600}})}});
  const controller = new AbortController();
  const promise = show(parent, {title: "Review", message: "Send?", detail: "EXACT-START" + "<script>private()</script>".repeat(400) + "EXACT-END", signal: controller.signal});
  const window = windows[0];
  const id = window.options.webPreferences.additionalArguments[0].split("=")[1];
  const event = {sender: window.webContents, senderFrame: window.webContents.mainFrame};
  const ready = () => ipcMain.emit("lawoss:host-review:ready", event, id);
  const answer = decision => ipcMain.emit("lawoss:host-review:decision", event, id, decision);
  return {ipcMain, parent, window, id, event, ready, answer, promise, controller};
}

test("constrains review to work area, isolates renderer and sends the exact context only to its own frame", async () => {
  const f = fixture(), options = f.window.options;
  assert.equal(options.parent, f.parent); assert.equal(options.modal, true);
  assert.ok(options.width <= 800 && options.height <= 600);
  assert.equal(options.maxHeight, options.height); assert.equal(options.maxWidth, options.width);
  assert.equal(options.webPreferences.sandbox, true); assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false); assert.equal(options.webPreferences.webviewTag, false);
  assert.match(options.webPreferences.preload, /host-review-preload\.cjs$/);
  assert.deepEqual(f.window.open({url: "https://invalid.test"}), {action: "deny"});
  f.ready();
  assert.ok(f.window.sent[1].detail.startsWith("EXACT-START")); assert.ok(f.window.sent[1].detail.endsWith("EXACT-END"));
  assert.ok(f.window.sent[1].detail.includes("<script>private()</script>"));
  f.answer("allow"); assert.deepEqual(await f.promise, {response: 1});
  assert.equal(f.ipcMain.listenerCount("lawoss:host-review:decision"), 0);
  assert.equal(f.ipcMain.listenerCount("lawoss:host-review:ready"), 0);
});

test("rejects cross-window, subframe, stale-request and pre-ready answers", async () => {
  const f = fixture(); let settled = false; f.promise.then(() => {settled = true;});
  f.answer("allow");
  f.ipcMain.emit("lawoss:host-review:ready", {...f.event, sender: {}}, f.id);
  f.ipcMain.emit("lawoss:host-review:decision", f.event, f.id, "allow");
  f.ready();
  f.ipcMain.emit("lawoss:host-review:decision", {...f.event, sender: {}}, f.id, "allow");
  f.ipcMain.emit("lawoss:host-review:decision", {...f.event, senderFrame: {}}, f.id, "allow");
  f.ipcMain.emit("lawoss:host-review:decision", f.event, "different-request", "allow");
  await Promise.resolve(); assert.equal(settled, false);
  f.answer("deny"); assert.deepEqual(await f.promise, {response: 0});
});

for (const reason of ["abort", "close", "parent-close", "escape", "navigation", "redirect", "crash"]) {
  test(`${reason} denies and prevents late allow`, async () => {
    const f = fixture(); f.ready();
    if (reason === "abort") f.controller.abort();
    if (reason === "close") f.window.destroy();
    if (reason === "parent-close") f.parent.emit("closed");
    if (reason === "escape") f.window.webContents.emit("before-input-event", {preventDefault() {}}, {key: "Escape", type: "keyDown"});
    if (["navigation", "redirect"].includes(reason)) {
      let prevented = false;
      f.window.webContents.emit(reason === "navigation" ? "will-navigate" : "will-redirect", {preventDefault() {prevented = true;}}, "https://invalid.test");
      assert.equal(prevented, true);
    }
    if (reason === "crash") f.window.webContents.emit("render-process-gone", {}, {});
    f.answer("allow"); assert.deepEqual(await f.promise, {response: 0});
    assert.equal(f.window.destroyed, true);
    assert.equal(f.parent.listenerCount("closed"), 0);
  });
}

test("isolated preload renders immutable textContent, exposes no app bridge, and defaults focus to Deny", () => {
  const elements = new Map(["heading", "message", "context", "deny", "allow"].map(id => [id, {textContent: "", disabled: true, focused: false, click() {}, addEventListener(type, fn) {this[type] = fn;}, focus() {this.focused = true;}}]));
  const sent = []; const ipc = Object.assign(new EventEmitter(), {send: (...args) => sent.push(args)});
  let mount = () => assert.fail("DOM listener missing");
  vm.runInNewContext(readFileSync(new URL("./host-review-preload.cjs", import.meta.url), "utf8"), {
    require: name => {assert.equal(name, "electron"); return {ipcRenderer: ipc};},
    process: {argv: ["--lawoss-review-id=owned-review"]},
    document: {getElementById: id => elements.get(id), addEventListener: (_type, fn) => {mount = fn;}},
  });
  mount(); assert.deepEqual(JSON.parse(JSON.stringify(sent[0])), ["lawoss:host-review:ready", "owned-review"]);
  const detail = '<script>globalThis.unsafe=true</script>\n' + "x".repeat(9000) + "EXACT-END";
  ipc.emit("lawoss:host-review:payload", {}, {reviewId: "different", detail});
  assert.equal(elements.get("context").textContent, "");
  ipc.emit("lawoss:host-review:payload", {}, {reviewId: "owned-review", title: "Review", message: "Send?", detail});
  assert.equal(elements.get("context").textContent, detail); assert.equal(elements.get("deny").focused, true);
  assert.equal(elements.get("allow").disabled, false);
  ipc.emit("lawoss:host-review:payload", {}, {reviewId: "owned-review", detail: "REPLACED"});
  assert.equal(elements.get("context").textContent, detail);
  elements.get("allow").click();
  assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))), ["lawoss:host-review:decision", "owned-review", "allow"]);
});
