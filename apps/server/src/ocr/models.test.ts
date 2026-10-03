import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadModelAsset } from "./models.js";

const roots: string[] = [];
const stopServers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stopServers.splice(0)) await stop();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
const bytes = Buffer.from("verified-model-fixture");
const asset = { name: "model.onnx", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };

async function modelEndpoint(reply: (response: ServerResponse) => void) {
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.url === "/mcp") { response.end("engine ready"); return; }
    requests++;
    reply(response);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  stopServers.push(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing model fixture port");
  const url = `http://127.0.0.1:${address.port}`;
  return { asset: { ...asset, url: `${url}/model` }, engineUrl: `${url}/mcp`, requests: () => requests };
}

test("model downloads stay isolated from engine requests and reuse verified assets without another download", async () => {
  const root = await mkdtemp(join(tmpdir(), "ocr-model-")); roots.push(root);
  const path = join(root, asset.name), download = await modelEndpoint(response => { response.end(bytes); });
  // Other server tests can still have engine synchronization requests in flight.
  const [, status] = await Promise.all([
    downloadModelAsset(download.asset, path, new AbortController().signal),
    fetch(download.engineUrl).then(response => response.text()),
  ]);
  expect(status).toBe("engine ready");
  expect(await readFile(path)).toEqual(bytes);
  await downloadModelAsset(download.asset, path, new AbortController().signal);
  expect(download.requests()).toBe(1);
  expect(await readdir(root)).toEqual([asset.name]);
});

test("corruption, over-limit streams and cancellation cannot publish a model", async () => {
  const root = await mkdtemp(join(tmpdir(), "ocr-model-")); roots.push(root);
  let reply = (response: ServerResponse) => { response.end("corrupt"); };
  const path = join(root, asset.name), download = await modelEndpoint(response => reply(response));
  await expect(downloadModelAsset(download.asset, path, new AbortController().signal)).rejects.toThrow("checksum");
  // Chunked transfer exercises the streaming limit without a Content-Length header.
  reply = response => { response.write(bytes); response.end(Buffer.alloc(1)); };
  await expect(downloadModelAsset(download.asset, path, new AbortController().signal)).rejects.toThrow("limit");
  const controller = new AbortController(); controller.abort();
  await expect(downloadModelAsset(download.asset, path, controller.signal)).rejects.toThrow();
  expect(download.requests()).toBe(2);
  expect(await readdir(root)).toEqual([]);
});
