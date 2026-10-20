import { useCallback, useLayoutEffect, useRef } from "react";
import { t } from "@/i18n";
import { registerDocumentVisualSource, type DocumentVisualSource } from "../panel/document-visual-source";

type Request = { expectedHash: string; bytes?: ArrayBuffer; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type Source = { url: string; hash: string | null; frame: HTMLIFrameElement | null; request: Request | null };
const visible = (frame: HTMLIFrameElement | null) => {
  if (!frame?.isConnected || frame.closest('[inert], [aria-hidden="true"]')) return false;
  const rect = frame.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight && frame.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
};

/** A fresh download alone is insufficient: acknowledge the immutable blob
 * actually loaded by the same persistent PDF viewer and verify its SHA-256. */
export function usePdfVisualSource(options: DocumentVisualSource & { enabled: boolean; refresh: (accept: (bytes: ArrayBuffer) => boolean) => Promise<void> }) {
  const latest = useRef(options); latest.current = options;
  const registration = useRef<ReturnType<typeof registerDocumentVisualSource> | null>(null);
  const pending = useRef<Request | null>(null);
  const source = useRef<Source | null>(null);
  const finish = useCallback((request: Request, error?: Error) => {
    if (pending.current !== request) return;
    pending.current = null; clearTimeout(request.timer);
    if (error) request.reject(error); else request.resolve();
  }, []);
  const acknowledge = useCallback(() => {
    const current = source.current, request = pending.current;
    if (!current?.hash || !request || current.request !== request || !visible(current.frame)) return;
    if (current.hash !== request.expectedHash) { finish(request, new Error(t("documents.sources_changed"))); return; }
    registration.current?.verified(current.hash); finish(request);
  }, [finish]);
  useLayoutEffect(() => {
    if (!options.enabled) return;
    const owner = registerDocumentVisualSource(options, {
      visible: () => visible(source.current?.frame ?? null),
      refresh: expectedHash => new Promise<void>((resolve, reject) => {
        if (pending.current) finish(pending.current, new Error(t("documents.visual_open_required")));
        owner.verified(null);
        const request: Request = { expectedHash, resolve, reject, timer: setTimeout(() => finish(request, new Error(t("documents.visual_open_required"))), 15000) };
        pending.current = request;
        void latest.current.refresh(bytes => { if (pending.current !== request) return false; request.bytes = bytes; return true; }).catch(error => finish(request, error instanceof Error ? error : new Error(t("documents.visual_open_required"))));
      }),
    });
    registration.current = owner;
    return () => { if (pending.current) finish(pending.current, new Error(t("documents.visual_open_required"))); owner.dispose(); registration.current = null; };
  }, [options.enabled, options.client, options.workspaceId, options.path, finish]);
  const prepared = useCallback((url: string, blob: Blob, bytes: ArrayBuffer) => {
    registration.current?.verified(null);
    const current: Source = { url, hash: null, frame: null, request: pending.current?.bytes === bytes ? pending.current : null };
    source.current = current;
    void blob.arrayBuffer().then(buffer => crypto.subtle.digest("SHA-256", buffer)).then(digest => {
      if (source.current !== current) return;
      current.hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join(""); acknowledge();
    }).catch(error => { if (current.request) finish(current.request, error instanceof Error ? error : new Error(t("documents.visual_open_required"))); });
  }, [acknowledge, finish]);
  const loaded = useCallback((url: string, frame: HTMLIFrameElement) => { if (source.current?.url === url) { source.current.frame = frame; acknowledge(); } }, [acknowledge]);
  const cleared = useCallback((url: string) => { if (source.current?.url === url) { source.current = null; registration.current?.verified(null); } }, []);
  return { prepared, loaded, cleared };
}
