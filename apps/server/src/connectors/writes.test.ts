import { expect, test } from "bun:test";
import { googleDriveAdapter, microsoftFilesAdapter, fileUploadInput, fileUpdateInput, folderCreateInput, MAX_CONNECTOR_UPLOAD } from "./files.js";
import type { ConnectorRequest } from "./request.js";

const bytes = Buffer.from([0, 255, 13, 10, 3]);
const upload = { name: "Contract #1.pdf", folderId: "client/folder", mimeType: "application/pdf", dataBase64: bytes.toString("base64") };
const googleFile = { id: "file", name: upload.name, mimeType: upload.mimeType };
const graphFile = { id: "file", name: upload.name, file: { mimeType: upload.mimeType }, eTag: '"version-1"' };

test("file writes reject unsafe names, injected headers, malformed or oversized base64 and wildcard ETags", () => {
  for (const name of ["../client.pdf", "C:\\client.pdf", ".", "..", "evil\r\nfile", "folder/file", "client.pdf."]) expect(fileUploadInput.safeParse({ ...upload, name }).success).toBe(false);
  for (const mimeType of ["application/pdf\r\nHost: evil.test", "application/vnd.google-apps.document; x=1"]) expect(fileUploadInput.safeParse({ ...upload, mimeType }).success).toBe(false);
  for (const dataBase64 of ["%%%", "abc", "Zh==", Buffer.alloc(MAX_CONNECTOR_UPLOAD + 1).toString("base64")]) expect(fileUploadInput.safeParse({ ...upload, dataBase64 }).success).toBe(false);
  expect(fileUploadInput.safeParse({ ...upload, dataBase64: Buffer.alloc(MAX_CONNECTOR_UPLOAD).toString("base64") }).success).toBe(true);
  for (const etag of ["*", '"x"\r\nHost: evil.test', ""]) expect(fileUpdateInput.safeParse({ fileId: "file", dataBase64: "", etag }).success).toBe(false);
  expect(fileUpdateInput.safeParse({ fileId: "file", dataBase64: "" }).success).toBe(false);
  expect(fileUploadInput.safeParse({ ...upload, uploadUrl: "https://evil.test" }).success).toBe(false);
});

test("Google uploads one multipart body with binary content and folder metadata directly to its fixed endpoint", async () => {
  await googleDriveAdapter.upload(async (path, options) => {
    const url = new URL(path, "https://www.googleapis.com");
    expect(url.pathname).toBe("/upload/drive/v3/files");
    expect(url.searchParams.get("uploadType")).toBe("multipart");
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(options?.method).toBe("POST");
    expect(options?.body).toBeUndefined();
    expect(options?.headers?.["Content-Type"]).toStartWith("multipart/related; boundary=legalwork-");
    if (!options?.rawBody) throw new Error("Expected multipart content");
    const body = Buffer.from(await options.rawBody.arrayBuffer());
    expect(body.includes(bytes)).toBe(true);
    expect(body.toString()).toContain('"parents":["client/folder"]');
    return googleFile;
  }, fileUploadInput.parse(upload));
});

test("Google get_file exposes the HTTP ETag and replacements use If-Match; native documents remain protected", async () => {
  const metadata = await googleDriveAdapter.get(async (_path, options) => { options?.onResponseHeaders?.(new Headers({ ETag: '"original"' })); return googleFile; }, { fileId: "file" });
  expect(metadata.etag).toBe('"original"');
  expect((await googleDriveAdapter.get(async () => googleFile, { fileId: "file" })).etag).toBeNull();
  let writes = 0;
  await googleDriveAdapter.update(async (path, options) => {
    options?.onResponseHeaders?.(new Headers({ ETag: '"original"' }));
    if (options?.method) {
      writes++;
      expect(path).toStartWith("/upload/drive/v3/files/file?uploadType=media");
      expect(options.method).toBe("PATCH");
      expect(options.headers?.["If-Match"]).toBe('"original"');
      expect(await options.rawBody?.arrayBuffer()).toEqual(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    return googleFile;
  }, fileUpdateInput.parse({ fileId: "file", mimeType: upload.mimeType, dataBase64: upload.dataBase64, etag: metadata.etag }));
  expect(writes).toBe(1);
  await expect(googleDriveAdapter.update(async () => googleFile, fileUpdateInput.parse({ fileId: "file", dataBase64: "", etag: '"original"' }))).rejects.toMatchObject({ code: "connector_file_update_unsupported" });
  for (const mimeType of ["application/vnd.google-apps.folder", "application/vnd.google-apps.document"]) await expect(googleDriveAdapter.update(async () => ({ ...googleFile, mimeType }), fileUpdateInput.parse({ fileId: "file", dataBase64: "", etag: '"original"' }))).rejects.toMatchObject({ code: "connector_file_update_unsupported" });
});

test("Microsoft uploads refuse conflicts, preserve byte bodies and encode folder and file names", async () => {
  for (const adapter of [microsoftFilesAdapter(), microsoftFilesAdapter({ personal: true }), microsoftFilesAdapter({ sharepoint: true })]) {
    const request: ConnectorRequest = async (path, options) => {
      const url = new URL(path, "https://graph.microsoft.com");
      expect(url.pathname).toBe("/v1.0/drives/library/items/client%2Ffolder:/Contract%20%231.pdf:/content");
      expect(url.searchParams.get("@microsoft.graph.conflictBehavior")).toBe("fail");
      expect(options?.method).toBe("PUT");
      expect(options?.headers?.["If-None-Match"]).toBe("*");
      expect(Buffer.from(await options!.rawBody!.arrayBuffer())).toEqual(bytes);
      return graphFile;
    };
    request.apiOrigin = "https://graph.microsoft.com";
    await adapter.upload(request, fileUploadInput.parse({ ...upload, driveId: "library" }));
  }
});

test("Microsoft replacements use ETags and reject folders; SharePoint writes require an explicit library", async () => {
  let mutations = 0;
  const adapter = microsoftFilesAdapter({ sharepoint: true });
  const input = fileUpdateInput.parse({ fileId: "existing/file", driveId: "library", dataBase64: "", etag: '"version-1"' });
  await adapter.update(async (path, options) => {
    if (options?.method) { mutations++; expect(path).toBe("/v1.0/drives/library/items/existing%2Ffile/content"); expect(options.method).toBe("PUT"); expect(options.headers?.["If-Match"]).toBe(input.etag); }
    return graphFile;
  }, input);
  expect(mutations).toBe(1);
  await expect(adapter.update(async () => ({ ...graphFile, eTag: '"changed"' }), input)).rejects.toMatchObject({ code: "connector_file_changed" });
  await expect(adapter.update(async () => ({ id: "file", name: "file", file: {} }), input)).rejects.toMatchObject({ code: "connector_file_update_unsupported" });
  await expect(adapter.update(async () => ({ ...graphFile, folder: {} }), input)).rejects.toMatchObject({ code: "connector_not_a_file" });
  for (const run of [() => adapter.upload(async () => { throw new Error("unexpected provider call"); }, fileUploadInput.parse(upload)), () => adapter.createFolder(async () => { throw new Error("unexpected provider call"); }, folderCreateInput.parse({ name: "Cases" }))]) await expect(run()).rejects.toMatchObject({ code: "connector_drive_required" });
});

test("folder creation uses native folder metadata without overwrite", async () => {
  await googleDriveAdapter.createFolder(async (path, options) => { expect(path).toStartWith("/drive/v3/files?"); expect(options?.body).toEqual({ name: "Cases", mimeType: "application/vnd.google-apps.folder", parents: ["root"] }); return { ...googleFile, name: "Cases", mimeType: "application/vnd.google-apps.folder" }; }, folderCreateInput.parse({ name: "Cases" }));
  await microsoftFilesAdapter().createFolder(async (path, options) => { expect(path).toBe("/v1.0/me/drive/root/children"); expect(options?.body).toEqual({ name: "Cases", folder: {}, "@microsoft.graph.conflictBehavior": "fail" }); return { id: "folder", name: "Cases", folder: {} }; }, folderCreateInput.parse({ name: "Cases" }));
});
