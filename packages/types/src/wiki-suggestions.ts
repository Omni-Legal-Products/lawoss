import { z } from "zod";

export const WikiSuggestionAttachmentInputSchema = z.object({
  sourcePath: z.string().min(1).max(4096).describe("Project-relative path to an already downloaded source file. Existing attachments retain their staged copies when this path and name are unchanged."),
  name: z.string().min(1).max(200).optional().describe("Optional reader-friendly filename, including its original extension."),
});
export const WikiSuggestionAttachmentSchema = WikiSuggestionAttachmentInputSchema.extend({
  name: z.string().min(1).max(200),
  path: z.string(), filePath: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
});
export type WikiSuggestionAttachment = z.infer<typeof WikiSuggestionAttachmentSchema>;

export const WikiSuggestionDestinationSchema = z.object({
  wikiId: z.string().min(1).max(200),
  path: z.string().min(1).max(4096),
  baseRevision: z.string().max(500).nullable(),
  /** Research wiki parents are proposed in the draft and created only by human Save. */
  createFolders: z.boolean().optional(),
});
export const WikiSuggestionInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(2_000_000),
  destination: WikiSuggestionDestinationSchema,
  attachments: z.array(WikiSuggestionAttachmentInputSchema).max(20).optional().describe("Source files to stage with this page, up to 20 files and 100 MB combined. Omit on update to retain attachments; [] removes them. Never write them directly into the wiki."),
});
export const WikiSuggestionSchema = WikiSuggestionInputSchema.extend({
  attachments: z.array(WikiSuggestionAttachmentSchema).max(20).default([]),
  id: z.string().uuid(), workspaceId: z.string(), sessionId: z.string().nullable(),
  status: z.enum(["pending", "saved", "dismissed"]),
  createdAt: z.number(), updatedAt: z.number(),
  revision: z.string(), filePath: z.string(),
});
export type WikiSuggestion = z.infer<typeof WikiSuggestionSchema>;
export type WikiSuggestionInput = z.infer<typeof WikiSuggestionInputSchema>;
export type WikiSuggestionDestination = z.infer<typeof WikiSuggestionDestinationSchema>;
export type WikiContribution = Omit<WikiSuggestion, "content"> & { projectName: string; changes?: import("./line-diff.js").LineChanges | null };

export function wikiSuggestionFile(id: string) { return `.legalwork/tmp/wiki-suggestions/${id}/draft.md`; }

/** Keep portable source links correct when the user moves a draft or removes a file. */
export function wikiSuggestionContent(content: string, page: string, attachments: Pick<WikiSuggestionAttachment, "name" | "path">[]) {
  const body = content.replace(/\n*<!-- legalwork:source-files -->\n[\s\S]*?<!-- \/legalwork:source-files -->\n?/g, "");
  if (!attachments.length) return body;
  const folder = page.split("/").slice(0, -1);
  const links = attachments.map(file => {
    const target = file.path.split("/");
    let common = 0;
    while (common < folder.length && folder[common] === target[common]) common++;
    const relative = [...folder.slice(common).map(() => ".."), ...target.slice(common)].map(part => encodeURIComponent(part).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16)}`)).join("/");
    return `- [${file.name.replace(/[\\[\]]/g, "\\$&")}](${relative})`;
  });
  return `${body.trimEnd()}\n\n<!-- legalwork:source-files -->\n## Source files\n\n${links.join("\n")}\n<!-- /legalwork:source-files -->\n`;
}
export function suggestionIdFromFile(path: string) {
  const match = /(?:^|\/)\.legalwork\/tmp\/wiki-suggestions\/([^/]+)\/draft\.md$/.exec(path);
  const id = z.string().uuid().safeParse(match?.[1]);
  return id.success ? id.data : null;
}
