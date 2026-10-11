import { projectAttachmentClipboardSchema, type ProjectFileSource } from "@legalwork/types/project-files";
import { createProjectAttachmentMention, parseWorkspaceAttachmentLink, WORKSPACE_ATTACHMENT_LINK_SOURCE } from "./workspace-attachment";

const attribute = "data-legalwork-attachments";

/** Plain text remains portable. HTML carries only validated file provenance,
 * never replacement prose or executable instructions. */
export async function copyMessageWithAttachments(text: string, identify: (file: { name: string; path: string }) => { source: ProjectFileSource; projectName: string } | null) {
  const references = [...text.matchAll(new RegExp(WORKSPACE_ATTACHMENT_LINK_SOURCE, "g"))].flatMap(([link]) => {
    const file = parseWorkspaceAttachmentLink(link);
    const origin = file && identify(file);
    return origin ? [{ link, ...origin }] : [];
  });
  if (!references.length) return navigator.clipboard.writeText(text);
  const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const metadata = encodeURIComponent(JSON.stringify(references)).replaceAll("'", "%27");
  await navigator.clipboard.write([new ClipboardItem({
    "text/plain": new Blob([text], { type: "text/plain" }),
    "text/html": new Blob([`<pre ${attribute}='${metadata}'>${escaped}</pre>`], { type: "text/html" }),
  })]);
}


export function attachmentClipboardParts(text: string, metadata: string) {
  try {
    const references = projectAttachmentClipboardSchema.parse(JSON.parse(decodeURIComponent(metadata)));
    const byLink = new Map(references.filter(item => {
      const file = parseWorkspaceAttachmentLink(item.link);
      return file !== null && file.path === item.source.path && file.name === item.source.name;
    }).map(item => [item.link, item]));
    if (!byLink.size) return null;
    return text.split(new RegExp(`(${WORKSPACE_ATTACHMENT_LINK_SOURCE})`, "g")).map(value => {
      const reference = byLink.get(value);
      return reference ? { mention: createProjectAttachmentMention(reference.source, reference.projectName) } : { text: value };
    });
  } catch { return null; }
}

export function readAttachmentClipboard(text: string, html: string) {
  const metadata = new DOMParser().parseFromString(html, "text/html").querySelector(`[${attribute}]`)?.getAttribute(attribute);
  return metadata ? attachmentClipboardParts(text, metadata) : null;
}
