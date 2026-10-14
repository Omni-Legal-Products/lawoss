import { afterEach, expect, test } from "bun:test";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ConnectorRequestOptions, StreamingConnectorRequest } from "../connectors/request.js";
import { googleStorageAdapter, microsoftStorageAdapter } from "./cloud-drives.js";
import { nativeSegment } from "./native-drive.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function requestFixture(origin: string, handler: (url: URL, options: ConnectorRequestOptions) => Response | Promise<Response>) {
  const calls: { url: URL; options: ConnectorRequestOptions }[] = [];
  const response = async (path: string, options: ConnectorRequestOptions = {}) => { const url = new URL(path, origin); calls.push({ url, options }); return handler(url, options); };
  const request: StreamingConnectorRequest = Object.assign(async (path: string, options: ConnectorRequestOptions = {}) => {
    const result = await response(path, options); return options.empty ? null : result.json();
  }, { apiOrigin: origin, response, assertWrite: async () => {} });
  return { request, calls };
}
const root = { id: "root-id", name: "Drive", mimeType: "application/vnd.google-apps.folder", parents: [], version: "1" };
const google = (value: unknown, etag = '"version-1"') => Response.json(value, { headers: { etag } });

test("Google exports Docs, Sheets and Slides into their correct editable Office formats", async () => {
  for (const [kind, extension, type] of [["document", "docx", "wordprocessingml.document"], ["spreadsheet", "xlsx", "spreadsheetml.sheet"], ["presentation", "pptx", "presentationml.presentation"]]) {
    const file = { id: "native", name: "Report", mimeType: `application/vnd.google-apps.${kind}`, parents: [root.id], version: "2" };
    const { request, calls } = requestFixture("https://www.googleapis.com", (url) => url.pathname.endsWith("/export") ? new Response("exported bytes") : url.pathname.endsWith("/native") ? google(file) : url.pathname.endsWith("/files") ? google({ files: [file] }) : google(root));
    const adapter = await googleStorageAdapter({ kind: "oauth", provider: "google-drive", root: "", accountId: "account" }, request);
    const entry = (await adapter.list("")).entries[0]; expect(entry.name).toBe(`Report.${extension}`); expect(entry.exported).toBe(true);
    const copy = await adapter.read(entry.path); expect(copy.writable).toBe(false); expect(copy.data.toString()).toBe("exported bytes");
    expect(calls.find((call) => call.url.pathname.endsWith("/export"))?.url.searchParams.get("mimeType")).toContain(type!);
  }
});

test("Google uses resumable bounded-memory upload chunks beyond the old 5 MB limit", async () => {
  const sizes: number[] = [];
  const { request, calls } = requestFixture("https://www.googleapis.com", async (url, options) => {
    if (url.pathname.startsWith("/upload/") && options.method === "POST") return new Response(null, { headers: { location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=fixture" } });
    if (options.method === "PUT") {
      sizes.push(options.rawBody?.size ?? -1);
      return sizes.length === 1 ? new Response(null, { status: 308, headers: { range: `bytes=0-${8 * 1024 * 1024 - 1}` } }) : google({ id: "new" });
    }
    return url.pathname.endsWith("/files") ? google({ files: [] }) : google(root);
  });
  const adapter = await googleStorageAdapter({ kind: "oauth", provider: "google-drive", root: "", accountId: "account" }, request);
  const directory = await mkdtemp(join(tmpdir(), "google-upload-"));
  try {
    const source = join(directory, "large"); await writeFile(source, Buffer.alloc(12 * 1024 * 1024));
    await adapter.upload("Large.bin", source, "application/octet-stream", { createOnly: true });
    expect(sizes).toEqual([8 * 1024 * 1024, 4 * 1024 * 1024]);
    expect(calls.find((call) => call.options.method === "POST")?.options.body).toEqual({ name: "Large.bin", mimeType: "application/octet-stream", parents: [root.id] });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Google rejects upload-session URLs outside the provider origin before transferring bytes", async () => {
  const { request, calls } = requestFixture("https://www.googleapis.com", (url, options) => options.method === "POST" ? new Response(null, { headers: { location: "https://attacker.test/upload" } }) : url.pathname.endsWith("/files") ? google({ files: [] }) : google(root));
  const adapter = await googleStorageAdapter({ kind: "oauth", provider: "google-drive", root: "", accountId: "account" }, request);
  await expect(adapter.write("File.txt", Buffer.from("file"), "text/plain", { createOnly: true })).rejects.toMatchObject({ code: "storage_invalid_response" });
  expect(calls.some((call) => call.options.method === "PUT")).toBe(false);
});

function microsoftFixture(location = "https://fixture.sharepoint.com/download") {
  const root = { id: "folder-root", name: "Library", folder: {}, eTag: '"root-version"' };
  const file = { id: "file", name: "Large.docx", file: { mimeType: "application/octet-stream" }, eTag: '"file-version"', size: 22 * 1024 * 1024, parentReference: { id: root.id, driveId: "drive-1" }, "@microsoft.graph.downloadUrl": location };
  const fixture = requestFixture("https://graph.microsoft.com", (url) => url.pathname.endsWith("/drive") || url.pathname.endsWith("/drive-1") ? Response.json({ id: "drive-1" }) : url.pathname.endsWith("/children") ? Response.json({ value: [file] }) : Response.json(url.pathname.endsWith("/file") ? file : root));
  return { ...fixture, root, file };
}

test("Microsoft selects explicit drive/library identities and downloads large content without forwarding OAuth", async () => {
  const { request, calls, file } = microsoftFixture();
  const downloaded: { url: string; authorization: string | null }[] = [];
  globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => { downloaded.push({ url: String(input), authorization: new Headers(init?.headers).get("Authorization") }); return new Response(new Uint8Array(22 * 1024 * 1024)); }, { preconnect: originalFetch.preconnect });
  const adapter = await microsoftStorageAdapter({ kind: "oauth", provider: "sharepoint-files", driveId: "drive-1", root: "", accountId: "account" }, request);
  const directory = await mkdtemp(join(tmpdir(), "microsoft-download-"));
  try { expect((await adapter.download(nativeSegment(file), join(directory, "content"))).size).toBe(22 * 1024 * 1024); }
  finally { await rm(directory, { recursive: true, force: true }); }
  expect(calls.every((call) => call.url.pathname.startsWith("/v1.0/drives/drive-1"))).toBe(true);
  expect(downloaded).toEqual([{ url: "https://fixture.sharepoint.com/download", authorization: null }]);
});

test("Microsoft rejects untrusted content URLs and SharePoint without a selected library", async () => {
  const { request, file } = microsoftFixture("http://127.0.0.1/private");
  const adapter = await microsoftStorageAdapter({ kind: "oauth", provider: "sharepoint-files", driveId: "drive-1", root: "", accountId: "account" }, request);
  await expect(adapter.download(nativeSegment(file))).rejects.toMatchObject({ code: "storage_invalid_response" });
  await expect(microsoftStorageAdapter({ kind: "oauth", provider: "sharepoint-files", root: "", accountId: "account" }, request)).rejects.toMatchObject({ code: "storage_drive_required" });
});

test("Microsoft replacement sends a conditional version and streams a file-backed Blob", async () => {
  const { request, calls, file } = microsoftFixture();
  const directory = await mkdtemp(join(tmpdir(), "microsoft-upload-"));
  try {
    const source = join(directory, "new"); await writeFile(source, Buffer.alloc(7 * 1024 * 1024));
    const adapter = await microsoftStorageAdapter({ kind: "oauth", provider: "onedrive", root: "", accountId: "account" }, request);
    await adapter.upload(nativeSegment(file), source, "application/octet-stream", { version: '"file-version"' });
    const uploaded = calls.find((call) => call.options.method === "PUT"); expect(uploaded?.options.headers?.["If-Match"]).toBe('"file-version"');
    expect(uploaded?.options.rawBody?.size).toBe((await readFile(source)).length);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test("Microsoft creates files above 250 MB in bounded chunks on a signed session, without bearer credentials", async () => {
  const root = { id: "root", name: "Drive", folder: {}, eTag: '"root-version"' };
  const { request } = requestFixture("https://graph.microsoft.com", (url, options) => options.method === "POST" ? Response.json({ uploadUrl: "https://fixture.up.1drv.com/upload" }) : url.pathname.endsWith("/children") ? Response.json({ value: [] }) : url.pathname.endsWith("/drive") ? Response.json({ id: "drive-1" }) : Response.json(root));
  let uploaded = 0; let guarded = 0; const sizes: number[] = [];
  request.assertWrite = async () => { guarded++; };
  globalThis.fetch = Object.assign(async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const headers = new Headers(init?.headers); expect(headers.get("Authorization")).toBeNull();
    const size = Number(headers.get("Content-Length")); sizes.push(size); uploaded += size;
    return new Response(null, { status: uploaded === 251 * 1024 * 1024 ? 201 : 202 });
  }, { preconnect: originalFetch.preconnect });
  const directory = await mkdtemp(join(tmpdir(), "microsoft-large-upload-"));
  try {
    const source = join(directory, "large"); const file = await open(source, "w"); await file.truncate(251 * 1024 * 1024); await file.close();
    const adapter = await microsoftStorageAdapter({ kind: "oauth", provider: "onedrive", root: "", accountId: "account" }, request);
    await adapter.upload("Large.bin", source, "application/octet-stream", { createOnly: true });
    expect(uploaded).toBe(251 * 1024 * 1024); expect(Math.max(...sizes)).toBe(10 * 1024 * 1024); expect(guarded).toBe(sizes.length);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 30_000);
