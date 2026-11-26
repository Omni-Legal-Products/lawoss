// Activated only by the synthetic native harness on this diagnostic branch.
export function syntheticGenerationStage(stage: string) {
  if (typeof document !== "undefined" && document.documentElement.hasAttribute("data-isir-probe")) {
    document.documentElement.dataset.isirProbe = stage;
  }
}
export function syntheticGenerationFailure(error: unknown) {
  if (typeof document === "undefined" || !document.documentElement.hasAttribute("data-isir-probe")) return;
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  const status = error && typeof error === "object" && "status" in error ? error.status : null;
  const known = ["document_stale", "document_pending", "workspace_not_found", "request_failed", "invalid_payload", "unauthorized", "forbidden", "internal_error"];
  const message = error instanceof Error ? error.message : "";
  const kind = typeof code === "string" && known.includes(code) ? code :
    message === "Request timed out." ? "timeout" : message === "Failed to fetch" ? "fetch-failed" :
    error instanceof TypeError ? "type-error" : error instanceof SyntaxError ? "syntax-error" : "other";
  document.documentElement.dataset.isirFailure = kind;
  if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599) document.documentElement.dataset.isirStatus = String(status);
}
