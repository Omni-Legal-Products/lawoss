import { z } from "zod";

export const WikiSuggestionDestinationSchema = z.object({
  wikiId: z.string().min(1).max(200),
  path: z.string().min(1).max(4096),
  baseRevision: z.string().max(500).nullable(),
});
export const WikiSuggestionInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(2_000_000),
  destination: WikiSuggestionDestinationSchema,
});
export const WikiSuggestionSchema = WikiSuggestionInputSchema.extend({
  id: z.string().uuid(), workspaceId: z.string(), sessionId: z.string().nullable(),
  status: z.enum(["pending", "saved", "dismissed"]),
  createdAt: z.number(), updatedAt: z.number(),
  revision: z.string(), filePath: z.string(),
});
export type WikiSuggestion = z.infer<typeof WikiSuggestionSchema>;
export type WikiSuggestionInput = z.infer<typeof WikiSuggestionInputSchema>;
export type WikiSuggestionDestination = z.infer<typeof WikiSuggestionDestinationSchema>;

export function wikiSuggestionFile(id: string) { return `.legalwork/tmp/wiki-suggestions/${id}/draft.md`; }
export function suggestionIdFromFile(path: string) {
  const match = /(?:^|\/)\.legalwork\/tmp\/wiki-suggestions\/([^/]+)\/draft\.md$/.exec(path);
  const id = z.string().uuid().safeParse(match?.[1]);
  return id.success ? id.data : null;
}
