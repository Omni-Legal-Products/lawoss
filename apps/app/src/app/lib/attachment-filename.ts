/** Older copied message badges accidentally became filenames, including the
 * project label after the extension. Recover only that attachment format. */
export function attachmentFilename(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  if (!/^(?:\.legalwork|\.opencode\/legalwork\/inbox)?\/?attachments\/[^/]+\/[^/]+$/.test(path)) return name;
  return name.replace(/(\.(?:docx|docm|dotx|dotm|xlsx|xls|csv|tsv|pptx|pptm|pdf|md|markdown|txt|png|jpe?g|webp))___.*$/i, "$1");
}
