import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { parseBoolean } from "../config.js";
import { ApiError } from "../errors.js";
import { withFileWriteLock } from "../file-write-lock.js";
import type { ServerConfig } from "../types.js";

export function ocrDownloadSettings(config: ServerConfig) {
  return {
    autoDownload: config.autoDownloadOcr === true,
    autoDownloadLocked: parseBoolean(process.env.LEGALWORK_OCR_AUTO_DOWNLOAD) !== undefined || !config.configPath,
  };
}

/** Persist the existing server setting; never replace other host configuration. */
export async function setOcrAutoDownload(config: ServerConfig, enabled: boolean) {
  if (ocrDownloadSettings(config).autoDownloadLocked || !config.configPath) {
    throw new ApiError(409, "ocr_download_managed", "Automatic downloads are controlled by the server configuration.");
  }
  const path = config.configPath;
  await withFileWriteLock(path, async () => {
    const raw = await readFile(path, "utf8").catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return "{}";
      throw error;
    });
    const current = z.record(z.string(), z.unknown()).parse(JSON.parse(raw));
    const temporary = `${path}.tmp.${randomUUID()}`;
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(temporary, JSON.stringify({ ...current, autoDownloadOcr: enabled }, null, 2) + "\n", { mode: 0o600 });
      await rename(temporary, path);
      config.autoDownloadOcr = enabled;
    } finally { await rm(temporary, { force: true }); }
  });
}
