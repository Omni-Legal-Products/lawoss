import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { ConnectorRequest } from "./request.js";
import { accountInput, nativeId, nativePagePath, parseNative, microsoftDownload, MAX_CONNECTOR_DOWNLOAD } from "./native.js";

export const fileListInput = accountInput.extend({
  driveId: nativeId.optional(), folderId: nativeId.optional(), query: z.string().trim().min(1).max(500).optional(),
  maxResults: z.number().int().min(1).max(100).default(25), pageToken: z.string().max(8192).optional(),
}).strict();
export const fileGetInput = accountInput.extend({ driveId: nativeId.optional(), fileId: nativeId }).strict();
export const fileDownloadInput = fileGetInput.extend({ exportFormat: z.enum(["pdf", "docx", "xlsx", "pptx", "txt", "csv"]).optional() }).strict();
export const driveListInput = accountInput.extend({ siteId: nativeId.optional(), maxResults: z.number().int().min(1).max(100).default(25), pageToken: z.string().max(8192).optional() }).strict();
export const siteListInput = accountInput.extend({ query: z.string().trim().min(1).max(500).default("*"), maxResults: z.number().int().min(1).max(100).default(25), pageToken: z.string().max(8192).optional() }).strict();

export const MAX_CONNECTOR_UPLOAD = 5 * 1024 * 1024;
const fileName = z.string().trim().min(1).max(255).refine((value) => !/[\\/:*?"<>|\x00-\x1f\x7f]/.test(value) && value !== "." && value !== ".." && !/[. ]$/.test(value), "Use a filename without path separators or reserved characters.");
const mimeType = z.string().max(255).regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/).default("application/octet-stream");
const dataBase64 = z.string().max(Math.ceil(MAX_CONNECTOR_UPLOAD / 3) * 4).refine((value) => /^[A-Za-z0-9+/]*={0,2}$/.test(value) && Buffer.from(value, "base64").byteLength <= MAX_CONNECTOR_UPLOAD && Buffer.from(value, "base64").toString("base64") === value, "Provide valid base64 for a file up to 5 MB.");
const etag = z.string().max(1000).regex(/^(?:W\/)?"[^"\r\n]+"$/, "Provide the ETag from get_file before replacing file content.");
export const fileUploadInput = accountInput.extend({ driveId: nativeId.optional(), folderId: nativeId.optional(), name: fileName, mimeType, dataBase64 }).strict();
export const fileUpdateInput = fileGetInput.extend({ mimeType, dataBase64, etag }).strict();
export const folderCreateInput = accountInput.extend({ driveId: nativeId.optional(), folderId: nativeId.optional(), name: fileName }).strict();
function checkFileETag(current: string | null | undefined, expected: string) {
  if (!current || !etag.safeParse(current).success) throw new ApiError(409, "connector_file_update_unsupported", "The provider did not supply a usable ETag. This file cannot be safely replaced.");
  if (current !== expected) throw new ApiError(409, "connector_file_changed", "This file changed since you read it. Read its details again before replacing it.");
}
function fileBlob(input: { dataBase64: string; mimeType: string }) {
  return new Blob([Buffer.from(input.dataBase64, "base64")], { type: input.mimeType });
}

const downloadResult = z.object({ dataBase64: z.string(), size: z.number(), mimeType: z.string().nullable() });
const googleFile = z.object({ id: z.string(), name: z.string(), mimeType: z.string(), size: z.string().optional(), modifiedTime: z.string().optional(), webViewLink: z.string().optional(), parents: z.array(z.string()).optional(), description: z.string().optional() });
const googleFields = "id,name,mimeType,size,modifiedTime,webViewLink,parents,description";
const graphFile = z.object({ id: z.string(), name: z.string(), size: z.number().optional(), lastModifiedDateTime: z.string().optional(), webUrl: z.string().optional(),
  eTag: z.string().optional(), file: z.object({ mimeType: z.string().optional() }).optional(), folder: z.object({ childCount: z.number().optional() }).optional(),
  parentReference: z.object({ driveId: z.string().optional() }).optional(), "@microsoft.graph.downloadUrl": z.string().optional(), "@content.downloadUrl": z.string().optional(),
});
const googleSummary = (file: z.infer<typeof googleFile>) => ({ id: file.id, name: file.name, kind: file.mimeType === "application/vnd.google-apps.folder" ? "folder" : "file",
  mimeType: file.mimeType, size: file.size ? Number(file.size) : null, modifiedAt: file.modifiedTime ?? null, webUrl: file.webViewLink ?? null, parents: file.parents ?? [], description: file.description ?? "" });
const graphSummary = (file: z.infer<typeof graphFile>) => ({ id: file.id, name: file.name, kind: file.folder ? "folder" : "file", mimeType: file.file?.mimeType ?? null,
  size: file.size ?? null, modifiedAt: file.lastModifiedDateTime ?? null, webUrl: file.webUrl ?? null, driveId: file.parentReference?.driveId ?? null, etag: file.eTag ?? null });


function checkSize(size?: number) {
  if (size !== undefined && size > MAX_CONNECTOR_DOWNLOAD) throw new ApiError(413, "connector_file_too_large", "This file exceeds the 20 MB connector download limit.");
}
function requireFile(folder: boolean) {
  if (folder) throw new ApiError(400, "connector_not_a_file", "Choose a file to download.");
}
function noDrive(value: { driveId?: string }) {
  if (value.driveId) throw new ApiError(400, "invalid_payload", "This connector uses file identifiers, not driveId.");
}
const exportTypes = {
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", csv: "text/csv",
};
const googleLiteral = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export const googleDriveAdapter = {
  async test(request: ConnectorRequest) {
    parseNative(z.object({ files: z.array(z.object({ id: z.string() })).default([]) }), await request("/drive/v3/files?pageSize=1&fields=files(id)&q=trashed%3Dfalse"));
    return { ok: true };
  },
  async list(request: ConnectorRequest, input: z.infer<typeof fileListInput>) {
    noDrive(input);
    const filters = ["trashed = false"];
    if (input.folderId || !input.query) filters.push(`'${googleLiteral(input.folderId ?? "root")}' in parents`);
    if (input.query) filters.push(`fullText contains '${googleLiteral(input.query)}'`);
    const query = new URLSearchParams({ q: filters.join(" and "), pageSize: String(input.maxResults), fields: `nextPageToken,incompleteSearch,files(${googleFields})`, supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
    if (input.pageToken) query.set("pageToken", input.pageToken);
    const page = parseNative(z.object({ files: z.array(googleFile).default([]), nextPageToken: z.string().optional(), incompleteSearch: z.boolean().optional() }), await request(`/drive/v3/files?${query}`));
    return { files: page.files.map(googleSummary), nextPageToken: page.nextPageToken ?? null, incompleteSearch: page.incompleteSearch ?? false };
  },
  async get(request: ConnectorRequest, input: z.infer<typeof fileGetInput>) {
    noDrive(input);
    const responseHeaders: { etag: string | null } = { etag: null };
    const file = parseNative(googleFile, await request(`/drive/v3/files/${encodeURIComponent(input.fileId)}?${new URLSearchParams({ fields: googleFields, supportsAllDrives: "true" })}`, { onResponseHeaders: (headers) => { responseHeaders.etag = headers.get("etag"); } }));
    return { ...googleSummary(file), etag: responseHeaders.etag };
  },
  async upload(request: ConnectorRequest, input: z.infer<typeof fileUploadInput>) {
    noDrive(input);
    const boundary = `legalwork-${randomUUID()}`;
    const metadata = { name: input.name, mimeType: input.mimeType, parents: [input.folderId ?? "root"] };
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`, fileBlob(input), `\r\n--${boundary}--\r\n`]);
    const query = new URLSearchParams({ uploadType: "multipart", fields: googleFields, supportsAllDrives: "true" });
    return googleSummary(parseNative(googleFile, await request(`/upload/drive/v3/files?${query}`, { method: "POST", rawBody: body, headers: { "Content-Type": `multipart/related; boundary=${boundary}` } })));
  },
  async update(request: ConnectorRequest, input: z.infer<typeof fileUpdateInput>) {
    noDrive(input);
    const responseHeaders: { etag: string | null } = { etag: null };
    const file = parseNative(googleFile, await request(`/drive/v3/files/${encodeURIComponent(input.fileId)}?${new URLSearchParams({ fields: googleFields, supportsAllDrives: "true" })}`, { onResponseHeaders: (headers) => { responseHeaders.etag = headers.get("etag"); } }));
    if (file.mimeType.startsWith("application/vnd.google-apps.")) throw new ApiError(400, "connector_file_update_unsupported", "Only uploaded files can have their contents replaced. Google Workspace documents and folders are not supported.");
    checkFileETag(responseHeaders.etag, input.etag);
    const query = new URLSearchParams({ uploadType: "media", fields: googleFields, supportsAllDrives: "true" });
    return googleSummary(parseNative(googleFile, await request(`/upload/drive/v3/files/${encodeURIComponent(input.fileId)}?${query}`, { method: "PATCH", rawBody: fileBlob(input), headers: { "Content-Type": input.mimeType, "If-Match": input.etag } })));
  },
  async createFolder(request: ConnectorRequest, input: z.infer<typeof folderCreateInput>) {
    noDrive(input);
    const query = new URLSearchParams({ fields: googleFields, supportsAllDrives: "true" });
    return googleSummary(parseNative(googleFile, await request(`/drive/v3/files?${query}`, { method: "POST", body: { name: input.name, mimeType: "application/vnd.google-apps.folder", parents: [input.folderId ?? "root"] } })));
  },
  async download(request: ConnectorRequest, input: z.infer<typeof fileDownloadInput>) {
    noDrive(input);
    const path = `/drive/v3/files/${encodeURIComponent(input.fileId)}`;
    const file = parseNative(googleFile, await request(`${path}?${new URLSearchParams({ fields: googleFields, supportsAllDrives: "true" })}`));
    requireFile(file.mimeType === "application/vnd.google-apps.folder");
    checkSize(file.size ? Number(file.size) : undefined);
    const native = file.mimeType.startsWith("application/vnd.google-apps.");
    const format = input.exportFormat ?? "pdf";
    const downloadPath = native ? `${path}/export?${new URLSearchParams({ mimeType: exportTypes[format] })}` : `${path}?alt=media&supportsAllDrives=true`;
    const data = parseNative(downloadResult, await request(downloadPath, { bytes: true }));
    return { ...data, filename: native ? `${file.name}.${format}` : file.name };
  },
};

export function microsoftFilesAdapter(options: { sharepoint?: boolean; personal?: boolean } = {}) {
  const origin = (request: ConnectorRequest) => request.apiOrigin ?? (options.personal ? "https://api.onedrive.com" : "https://graph.microsoft.com");
  const base = (request: ConnectorRequest) => origin(request) === "https://api.onedrive.com" ? "/v1.0/drive" : "/v1.0/me/drive";
  function drivePath(request: ConnectorRequest, driveId?: string) {
    if (options.sharepoint && !driveId) throw new ApiError(400, "connector_drive_required", "Choose a SharePoint document library using list_sites and list_drives, then provide its driveId.");
    return driveId ? `/v1.0/drives/${encodeURIComponent(driveId)}` : base(request);
  }
  return {
    async test(request: ConnectorRequest) {
      if (options.sharepoint) parseNative(z.object({ id: z.string() }), await request("/v1.0/sites/root?$select=id"));
      else parseNative(z.object({ id: z.string() }), await request(`${base(request)}?$select=id`));
      return { ok: true };
    },
    async sites(request: ConnectorRequest, input: z.infer<typeof siteListInput>) {
      const path = "/v1.0/sites";
      const query = new URLSearchParams({ search: input.query, "$top": String(input.maxResults), "$select": "id,displayName,webUrl" });
      const page = parseNative(z.object({ value: z.array(z.object({ id: z.string(), displayName: z.string().optional(), webUrl: z.string().optional() })), "@odata.nextLink": z.string().optional() }),
        await request(input.pageToken ? nativePagePath(input.pageToken, origin(request), path) : `${path}?${query}`));
      if (page["@odata.nextLink"]) nativePagePath(page["@odata.nextLink"], origin(request), path);
      return { sites: page.value, nextPageToken: page["@odata.nextLink"] ?? null };
    },
    async drives(request: ConnectorRequest, input: z.infer<typeof driveListInput>) {
      if (options.sharepoint && !input.siteId) throw new ApiError(400, "connector_site_required", "Choose a SharePoint site with list_sites, then provide its siteId.");
      const path = input.siteId ? `/v1.0/sites/${encodeURIComponent(input.siteId)}/drives` : "/v1.0/me/drives";
      const query = new URLSearchParams({ "$top": String(input.maxResults), "$select": "id,name,driveType,webUrl" });
      const page = parseNative(z.object({ value: z.array(z.object({ id: z.string(), name: z.string().optional(), driveType: z.string().optional(), webUrl: z.string().optional() })), "@odata.nextLink": z.string().optional() }),
        await request(input.pageToken ? nativePagePath(input.pageToken, origin(request), path) : `${path}?${query}`));
      if (page["@odata.nextLink"]) nativePagePath(page["@odata.nextLink"], origin(request), path);
      return { drives: page.value, nextPageToken: page["@odata.nextLink"] ?? null };
    },
    async list(request: ConnectorRequest, input: z.infer<typeof fileListInput>) {
      const folder = input.folderId && input.folderId !== "root" ? `/items/${encodeURIComponent(input.folderId)}` : "/root";
      const path = `${drivePath(request, input.driveId)}${folder}${input.query ? `/search(q='${encodeURIComponent(input.query.replace(/'/g, "''"))}')` : "/children"}`;
      const query = new URLSearchParams({ "$top": String(input.maxResults) });
      const page = parseNative(z.object({ value: z.array(graphFile), "@odata.nextLink": z.string().optional() }),
        await request(input.pageToken ? nativePagePath(input.pageToken, origin(request), path) : `${path}?${query}`));
      if (page["@odata.nextLink"]) nativePagePath(page["@odata.nextLink"], origin(request), path);
      return { files: page.value.map(graphSummary), nextPageToken: page["@odata.nextLink"] ?? null };
    },
    async get(request: ConnectorRequest, input: z.infer<typeof fileGetInput>) {
      return graphSummary(parseNative(graphFile, await request(`${drivePath(request, input.driveId)}/items/${encodeURIComponent(input.fileId)}`)));
    },
    async upload(request: ConnectorRequest, input: z.infer<typeof fileUploadInput>) {
      const parent = input.folderId && input.folderId !== "root" ? `/items/${encodeURIComponent(input.folderId)}` : "/root";
      const behavior = origin(request) === "https://api.onedrive.com" ? "@name.conflictBehavior" : "@microsoft.graph.conflictBehavior";
      const path = `${drivePath(request, input.driveId)}${parent}:/${encodeURIComponent(input.name)}:/content?${new URLSearchParams({ [behavior]: "fail" })}`;
      return graphSummary(parseNative(graphFile, await request(path, { method: "PUT", rawBody: fileBlob(input), headers: { "Content-Type": input.mimeType, "If-None-Match": "*" } })));
    },
    async update(request: ConnectorRequest, input: z.infer<typeof fileUpdateInput>) {
      const path = `${drivePath(request, input.driveId)}/items/${encodeURIComponent(input.fileId)}`;
      const file = parseNative(graphFile, await request(path));
      if (file.folder || !file.file) throw new ApiError(400, "connector_not_a_file", "Choose an uploaded file to replace.");
      checkFileETag(file.eTag, input.etag);
      return graphSummary(parseNative(graphFile, await request(`${path}/content`, { method: "PUT", rawBody: fileBlob(input), headers: { "Content-Type": input.mimeType, "If-Match": input.etag } })));
    },
    async createFolder(request: ConnectorRequest, input: z.infer<typeof folderCreateInput>) {
      const parent = input.folderId && input.folderId !== "root" ? `/items/${encodeURIComponent(input.folderId)}` : "/root";
      const behavior = origin(request) === "https://api.onedrive.com" ? "@name.conflictBehavior" : "@microsoft.graph.conflictBehavior";
      return graphSummary(parseNative(graphFile, await request(`${drivePath(request, input.driveId)}${parent}/children`, { method: "POST", body: { name: input.name, folder: {}, [behavior]: "fail" } })));
    },
    async download(request: ConnectorRequest, input: z.infer<typeof fileDownloadInput>) {
      if (input.exportFormat) throw new ApiError(400, "invalid_payload", "exportFormat is supported only by Google Drive.");
      const file = parseNative(graphFile, await request(`${drivePath(request, input.driveId)}/items/${encodeURIComponent(input.fileId)}`));
      requireFile(Boolean(file.folder)); checkSize(file.size);
      const downloadUrl = file["@microsoft.graph.downloadUrl"] ?? file["@content.downloadUrl"];
      if (!file.file || !downloadUrl) throw new ApiError(400, "connector_download_unavailable", "This item has no downloadable file content.");
      return { ...await microsoftDownload(downloadUrl), filename: file.name };
    },
  };
}
