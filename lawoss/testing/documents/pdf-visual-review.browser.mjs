// Explicit isolated mounted regression. Requires the built server; no real
// browser profile, client sources, model, credential or network provider.
// Usage: node pdf-visual-review.browser.mjs <chromium> <owned-output-directory>
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { connectRenderer, until } from "../isir/native/cdp.mjs";
import { stopNativeChild } from "../isir/native/owned-process.mjs";

const [chromium, output] = process.argv.slice(2);
assert.ok(chromium && path.isAbsolute(chromium) && output && path.isAbsolute(output), "Explicit owned browser/output paths required");
const repo = fileURLToPath(new URL("../../../", import.meta.url)), app = path.join(repo, "apps/app");
const requireApp = createRequire(path.join(app, "package.json")), requireServer = createRequire(path.join(repo, "apps/server/package.json"));
const { PDFDocument, rgb } = requireServer("pdf-lib");
const root = await mkdtemp(path.join(tmpdir(), "pdf-visual-viewer-")), workspace = path.join(root, "workspace");
await mkdir(workspace); await mkdir(output, { recursive: true });
const oldDb = process.env.LEGALWORK_RUNTIME_DB;
process.env.LEGALWORK_RUNTIME_DB = path.join(root, "runtime.sqlite");
let server, vite, browser, cdp, primary, ownsNeutral = false;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const neutral = path.join(app, "pdf-visual-review-probe.html");
try {
  const { startServer } = await import(new URL("../../../apps/server/dist/server.js", import.meta.url));
  const config = { host: "127.0.0.1", port: 0, token: "synthetic-client", hostToken: "synthetic-host", configPath: path.join(root, "server.json"), approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: ["*"], authorizedRoots: [workspace], readOnly: false, workspaces: [{ id: "visual", name: "Synthetic", path: workspace, preset: "starter", workspaceType: "local" }], startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false };
  async function source(version) {
    const pdf = await PDFDocument.create(), page = pdf.addPage();
    page.drawText(`Synthetic original ${version}: decorative border.`, { x: 40, y: 730, size: 15 }); page.drawRectangle({ x: 24, y: 24, width: 540, height: 780, borderColor: rgb(.4, .4, .5), borderWidth: 1 });
    const bytes = await pdf.save(); await writeFile(path.join(workspace, "border.pdf"), bytes); return sha(bytes);
  }
  const hashA = await source("A");
  server = await startServer(config);
  const baseUrl = `http://127.0.0.1:${server.port}`, endpoint = `${baseUrl}/workspace/visual/lawoss/documents`, headers = { "x-legalwork-host-token": "synthetic-host", "content-type": "application/json" };
  async function prepare(hash) {
    assert.equal((await fetch(`${endpoint}/prepare`, { method: "POST", headers, body: '{"paths":["border.pdf"]}' })).status, 200);
    return until(async () => (await (await fetch(endpoint, { headers })).json()).documents.find(record => record.hash === hash && record.status === "partial"), "actual current preparation", 15000);
  }
  await prepare(hashA);
  await writeFile(neutral, "<!doctype html><title>Owned synthetic PDF review regression</title>", { flag: "wx" });
  ownsNeutral = true;
  vite = spawn(process.execPath, [path.join(path.dirname(requireApp.resolve("vite/package.json")), "bin/vite.js"), "--host", "127.0.0.1", "--port", "0"], { cwd: app, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  let viteOutput = ""; vite.stdout.on("data", bytes => viteOutput += bytes); vite.stderr.on("data", bytes => viteOutput += bytes);
  const origin = await until(() => viteOutput.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0], "owned Vite URL");
  browser = spawn(chromium, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--remote-debugging-port=0", `--user-data-dir=${path.join(root, "browser")}`, `${origin}/pdf-visual-review-probe.html`], { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
  browser.stderr.resume();
  const port = await until(async () => { try { return (await readFile(path.join(root, "browser/DevToolsActivePort"), "utf8")).split("\n")[0]; } catch { return null; } }, "owned browser CDP");
  cdp = await connectRenderer(`http://127.0.0.1:${port}`); await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1450, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.evaluate(`import('/tests/pdf-visual-review.fixture.tsx').then(module => { window.__pdfReviewFixture = module.mountPdfVisualReviewFixture(${JSON.stringify(baseUrl)}, ${JSON.stringify(workspace)}); })`);
  const shownHash = () => cdp.evaluate(`(async()=>{const frame=document.querySelector('iframe[title="border.pdf"]');if(!frame?.src.startsWith('blob:'))return null;const bytes=await(await fetch(frame.src.split('#')[0])).arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');})()`);
  await until(async () => await shownHash() === hashA, "original A already displayed");
  await cdp.evaluate("window.__pdfReviewFixture.rememberOwner()");
  const hashB = await source("B"); await prepare(hashB);
  await cdp.evaluate("window.__pdfReviewFixture.refreshSources()");
  await until(() => cdp.evaluate(`document.body.textContent.includes(${JSON.stringify(hashB)})`), "new preparation B visible in native panel");
  assert.equal(await shownHash(), hashA, "Precondition: persistent viewer still shows A before explicit review-open");
  await cdp.evaluate(`window.__pdfReviewFixture.holdDownload();[...document.querySelectorAll('button')].find(button=>button.textContent==='Open original document').click()`);
  await until(() => cdp.evaluate("window.__pdfReviewFixture.downloadEntered()"), "review-open must request fresh bytes for B", 5000);
  assert.equal(await cdp.evaluate("document.querySelector('input[type=checkbox]').disabled"), true, "A must not authorize B while fresh download is held");
  const waiting = await cdp.send("Page.captureScreenshot", { format: "png" }); await writeFile(path.join(output, "refresh-pending.png"), Buffer.from(waiting.data, "base64"));
  await cdp.evaluate("window.__pdfReviewFixture.releaseDownload()");
  await until(async () => await shownHash() === hashB, "review-open must display exact B bytes");
  await until(() => cdp.evaluate("document.querySelector('input[type=checkbox]')?.disabled===false"), "loaded matching B enables confirmation");
  assert.equal(await cdp.evaluate("window.__pdfReviewFixture.ownerRetained()"), true, "Refresh must retain the actual persistent viewer owner and single path tab");
  // Screenshot-only compositor settling, after the unchanged source/hash gate.
  await new Promise(resolve => setTimeout(resolve, 750));
  const before = await cdp.send("Page.captureScreenshot", { format: "png" }); await writeFile(path.join(output, "before-confirmation.png"), Buffer.from(before.data, "base64"));
  await cdp.evaluate("document.querySelector('input[type=checkbox]').click();[...document.querySelectorAll('button')].find(button=>button.textContent==='Confirm decorative lines reviewed').click()");
  await until(() => cdp.evaluate("document.body.textContent.includes('Visual review recorded by the authenticated host')"), "actual review HTTP receipt for B");
  await new Promise(resolve => setTimeout(resolve, 750));
  const after = await cdp.send("Page.captureScreenshot", { format: "png" }); await writeFile(path.join(output, "after-confirmation.png"), Buffer.from(after.data, "base64"));
  const records = (await (await fetch(endpoint, { headers })).json()).documents;
  assert.equal(records.find(record => record.hash === hashB)?.visualReview?.sourceHash, hashB);
  assert.equal(records.find(record => record.hash === hashA)?.visualReview, undefined);
  const hashC = await source("C"); await prepare(hashC); await cdp.evaluate("window.__pdfReviewFixture.refreshSources()");
  await until(() => cdp.evaluate(`document.body.textContent.includes(${JSON.stringify(hashC)})`), "preparation C retracts prior B viewer receipt");
  assert.equal(await cdp.evaluate("document.querySelector('input[type=checkbox]').disabled"), true);
  await cdp.evaluate("window.__pdfReviewFixture.replayFirstDownload();[...document.querySelectorAll('button')].find(button=>button.textContent==='Open original document').click()");
  await until(async () => await shownHash() === hashA, "controlled transport replays actual previously fetched A bytes");
  await until(() => cdp.evaluate("document.querySelector('[role=alert]')?.textContent.toLowerCase().includes('changed')"), "wrong displayed SHA is refused visibly");
  assert.equal(await cdp.evaluate("document.querySelector('input[type=checkbox]').disabled"), true, "A may not authorize current C even after iframe load");
  const refused = (await (await fetch(endpoint, { headers })).json()).documents.find(record => record.hash === hashC);
  assert.equal(refused.visualReview, undefined);
  assert.equal(await cdp.evaluate("window.__pdfReviewFixture.ownerRetained()"), true);
  await writeFile(path.join(output, "receipt.json"), JSON.stringify({ syntheticOnly: true, actualNativePanelAndPersistentViewer: true, actualProductionHttp: true, originalAObservedBeforeReplacement: true, heldFreshReadKeepsConfirmationDisabled: true, immutableDisplayedBlobHashMatchesB: true, persistentOwnerAndSingleTabRetained: true, explicitHttpReceiptOnlyForB: true, newerPreparationRetractsPriorReceipt: true, replayedOldBytesRefusedAfterLoad: true }, null, 2));
  console.log("PASS: existing persistent PDF A -> replaced/reprepared B -> fresh displayed hash B -> explicit native review; owner retained");
  console.log("PASS: C preparation retracts B receipt; replayed actual A response loads but SHA mismatch cannot enable confirmation");
} catch (error) { primary = error; }
finally {
  const failures = [];
  try { await cdp?.evaluate("window.__pdfReviewFixture?.dispose();delete window.__pdfReviewFixture"); } catch (error) { failures.push(error); }
  cdp?.close();
  for (const child of [browser, vite]) try { await stopNativeChild(child, 5000); } catch (error) { failures.push(error); }
  try { await server?.stop(); } catch (error) { failures.push(error); }
  if (oldDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = oldDb;
  try { if (ownsNeutral) await rm(neutral, { force: true }); await rm(root, { recursive: true, force: true }); } catch (error) { failures.push(error); }
  if (primary) throw failures.length ? new AggregateError([primary, ...failures], "Primary mounted regression and cleanup failed") : primary;
  if (failures.length) throw new AggregateError(failures, "Mounted PDF review cleanup failed");
}
