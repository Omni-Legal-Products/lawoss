/**
 * Guard for the Word plugin. It lives outside the plugin module on purpose:
 * opencode calls every export of a plugin module as a plugin entry point
 * (`server(input)`), so a helper exported next to the plugin runs with the
 * engine's PluginInput — the same trap that broke engine start in
 * legalwork-skill-tools. The plugin is bundled standalone by `bun build`,
 * so this module is inlined.
 */

const FILE_BACKEND_MARKERS = ["docx-agent.mjs", "docx-redliner", ".redlined.docx"];

export function decodedDocumentUrl(documentUrl: string): string {
  try {
    return decodeURIComponent(documentUrl);
  } catch {
    return documentUrl;
  }
}

function documentName(documentUrl: string): string {
  const normalized = decodedDocumentUrl(documentUrl).replace(/\\/g, "/");
  return normalized.split("/").pop()?.trim().toLowerCase() ?? "";
}

/** Prevent the FILE backend from touching the document currently open in Word. */
export function isOpenWordFilePipelineCall(
  tool: string,
  args: Record<string, unknown>,
  documentUrl: string | null,
): boolean {
  if (!documentUrl || (tool !== "bash" && tool !== "task")) return false;
  const text = JSON.stringify(args).toLowerCase();
  if (!FILE_BACKEND_MARKERS.some((marker) => text.includes(marker))) return false;

  const decodedUrl = decodedDocumentUrl(documentUrl).toLowerCase();
  const name = documentName(documentUrl);
  return text.includes(documentUrl.toLowerCase()) || text.includes(decodedUrl) || Boolean(name && text.includes(name));
}
