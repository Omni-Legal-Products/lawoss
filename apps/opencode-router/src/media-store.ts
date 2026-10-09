import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";

import type { MediaKind } from "./media.js";
import { resolveWorkspacePath } from "./path-scope.js";

export type StoredMediaFile = {
  filePath: string;
  filename: string;
  sizeBytes: number;
  mimeType?: string;
};

function sanitizeSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "unknown";
}

function extensionFromMime(mimeType: string | undefined, kind: MediaKind): string {
  const value = (mimeType ?? "").toLowerCase();
  if (value === "image/jpeg") return ".jpg";
  if (value === "image/png") return ".png";
  if (value === "image/webp") return ".webp";
  if (value === "audio/ogg") return ".ogg";
  if (value === "audio/mpeg") return ".mp3";
  if (value === "audio/mp4") return ".m4a";
  if (value === "application/pdf") return ".pdf";
  if (kind === "image") return ".jpg";
  if (kind === "audio") return ".ogg";
  return ".bin";
}

function sanitizeFilename(filename: string, fallbackPrefix: string, fallbackExt: string): string {
  const trimmed = filename.trim();
  if (!trimmed) return `${fallbackPrefix}${fallbackExt}`;

  const base = basename(trimmed)
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!base) return `${fallbackPrefix}${fallbackExt}`;
  if (extname(base)) return base;
  return `${base}${fallbackExt}`;
}

export class MediaStore {
  constructor(private readonly rootDir: string, private readonly workspaceRoot: string) {}

  async ensureReady(): Promise<void> {
    await mkdir(resolveWorkspacePath(this.workspaceRoot, this.rootDir, true), { recursive: true });
  }

  private inboundDir(channel: string, identityId: string, peerId: string): string {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    return join(
      this.rootDir,
      "inbound",
      day,
      sanitizeSegment(channel),
      sanitizeSegment(identityId),
      sanitizeSegment(peerId),
    );
  }

  async saveInboundBuffer(input: {
    channel: string;
    identityId: string;
    peerId: string;
    kind: MediaKind;
    buffer: Uint8Array;
    filename?: string;
    mimeType?: string;
  }): Promise<StoredMediaFile> {
    const dir = resolveWorkspacePath(this.workspaceRoot, this.inboundDir(input.channel, input.identityId, input.peerId), true);
    await mkdir(dir, { recursive: true });

    const defaultExt = extensionFromMime(input.mimeType, input.kind);
    const safeFilename = sanitizeFilename(
      input.filename ?? "",
      `${input.kind}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      defaultExt,
    );
    const filePath = resolveWorkspacePath(this.workspaceRoot, join(dir, `${randomUUID()}-${safeFilename}`), true);

    await writeFile(filePath, input.buffer, { flag: "wx", mode: 0o600 });

    return {
      filePath,
      filename: safeFilename,
      sizeBytes: input.buffer.byteLength,
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    };
  }

  async downloadInbound(input: {
    channel: string;
    identityId: string;
    peerId: string;
    kind: MediaKind;
    url: string;
    headers?: Record<string, string>;
    filename?: string;
    mimeType?: string;
  }): Promise<StoredMediaFile> {
    const response = await fetch(input.url, {
      headers: input.headers,
    });

    if (!response.ok) {
      const error = new Error(`Failed to download media (${response.status})`) as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }

    const mimeType = input.mimeType || response.headers.get("content-type") || undefined;
    const arrayBuffer = await response.arrayBuffer();
    return this.saveInboundBuffer({
      channel: input.channel,
      identityId: input.identityId,
      peerId: input.peerId,
      kind: input.kind,
      buffer: new Uint8Array(arrayBuffer),
      ...(input.filename ? { filename: input.filename } : {}),
      ...(mimeType ? { mimeType } : {}),
    });
  }

  async resolveOutboundFile(input: {
    filePath: string;
    baseDirectory: string;
    workspaceRoot: string;
    maxBytes?: number;
  }): Promise<StoredMediaFile> {
    const raw = input.filePath.trim();
    if (!raw) {
      const error = new Error("filePath is required") as Error & { status?: number };
      error.status = 400;
      throw error;
    }

    let resolved: string;
    let info;
    try {
      // The caller's selected directory cannot redefine the workspace authority.
      const base = resolveWorkspacePath(input.workspaceRoot, input.baseDirectory);
      resolved = resolveWorkspacePath(input.workspaceRoot, isAbsolute(raw) ? resolve(raw) : resolve(base, raw));
      info = await stat(resolved);
    } catch (error) {
      if (error instanceof Error && "status" in error && error.status === 403) throw error;
      const wrapped = new Error(`File not found: ${raw}`) as Error & { status?: number };
      wrapped.status = 404;
      (wrapped as any).cause = error;
      throw wrapped;
    }

    if (!info.isFile()) {
      const error = new Error(`Not a file: ${resolved}`) as Error & { status?: number };
      error.status = 400;
      throw error;
    }

    if (typeof input.maxBytes === "number" && Number.isFinite(input.maxBytes) && info.size > input.maxBytes) {
      const error = new Error(
        `File exceeds maximum allowed size (${info.size} > ${Math.floor(input.maxBytes)} bytes): ${resolved}`,
      ) as Error & { status?: number };
      error.status = 413;
      throw error;
    }

    return {
      filePath: resolved,
      filename: basename(resolved),
      sizeBytes: info.size,
    };
  }
}
