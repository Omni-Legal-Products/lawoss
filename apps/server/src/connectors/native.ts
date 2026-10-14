import { z } from "zod";
import { ApiError } from "../errors.js";

export const nativeId = z.string().min(1).max(1000).refine((value) => value !== "." && value !== "..", "Invalid resource identifier.");
export const accountInput = z.object({ connectionId: z.string().min(1).max(500).optional() }).strict();
export const MAX_CONNECTOR_DOWNLOAD = 20 * 1024 * 1024;

export function parseNative<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(502, "connector_api_invalid", "The provider returned an invalid response.");
  return result.data;
}

/** Pagination links can only resume the same resource, never switch API endpoints. */
export function nativePagePath(value: string, origin: string, path: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new ApiError(400, "invalid_page_token", "Invalid page token."); }
  if (url.origin !== origin || url.pathname !== path || url.username || url.password || url.hash) {
    throw new ApiError(400, "invalid_page_token", "Invalid page token.");
  }
  return `${url.pathname}${url.search}`;
}

export async function boundedDownload(response: Response) {
  const tooLarge = () => new ApiError(413, "connector_file_too_large", "This file exceeds the 20 MB connector download limit.");
  if (Number(response.headers.get("Content-Length")) > MAX_CONNECTOR_DOWNLOAD) {
    await response.body?.cancel(); throw tooLarge();
  }
  if (!response.body) return { dataBase64: "", size: 0, mimeType: response.headers.get("Content-Type") };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_CONNECTOR_DOWNLOAD) { await reader.cancel(); throw tooLarge(); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  return { dataBase64: Buffer.concat(chunks, size).toString("base64"), size, mimeType: response.headers.get("Content-Type") };
}

/** Microsoft supplies short-lived content URLs. Never forward an OAuth token to them. */
export async function microsoftDownload(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new ApiError(502, "connector_invalid_download", "Invalid provider download URL."); }
  const allowed = [".sharepoint.com", ".files.1drv.com", ".onedrive.com", ".storage.live.com"];
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || !allowed.some((suffix) => url.hostname.endsWith(suffix))) {
    throw new ApiError(502, "connector_invalid_download", "Invalid provider download URL.");
  }
  let response: Response;
  try { response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60_000) }); }
  catch { throw new ApiError(502, "connector_download_failed", "Could not download this file directly from Microsoft. Try again."); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiError(502, "connector_download_failed", "Could not download this file directly from Microsoft. Try again.");
  }
  return boundedDownload(response);
}
