import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { parseFrontmatter } from "../../../../../lawoss/okf/src/frontmatter";

type Client = Pick<LegalworkServerClient, "readWorkspaceFile" | "writeWorkspaceFile">;
type Card = { title: string; cardPath?: string | null };

export function validMatterTitle(title: string): boolean {
  return Boolean(title.trim()) && title.trim().length <= 200 && !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(title);
}

export async function writeMatterTitle(client: Client, workspace: string, path: string, card: Card, title: string) {
  if (!validMatterTitle(title)) throw new Error("invalid_title");
  const line = `title: ${JSON.stringify(title.trim())}`;
  if (!card.cardPath) {
    await client.writeWorkspaceFile(workspace, { path, content: `---\ntype: spis\n${line}\n---\n`, createOnly: true });
    return;
  }
  const { content } = await client.readWorkspaceFile(workspace, path);
  const fields = parseFrontmatter(content);
  if (!fields || (fields.title?.trim() && fields.title.trim() !== card.title)) throw new Error("case_changed");
  // Preserve the BOM, mixed line endings, unrelated fields and body byte for byte.
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const end = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---" && line.startsWith("---"));
  if (end < 1) throw new Error("invalid_card");
  const fieldsOnly = lines.slice(1, end);
  const indexes = fieldsOnly.flatMap((field, index) => /^title[ \t]*:/.test(field) ? [index + 1] : []);
  if (indexes.length > 1) throw new Error("invalid_card");
  const index = indexes[0] ?? end;
  if (index < end) {
    const continuation = lines.slice(index + 1, end).find(field => field.trim() && !field.trimStart().startsWith("#"));
    if (continuation && /^\s/.test(continuation)) throw new Error("invalid_card");
    lines[index] = line + (lines[index]!.endsWith("\r\n") ? "\r\n" : "\n");
  } else {
    lines.splice(end, 0, line + (lines[0]!.endsWith("\r\n") ? "\r\n" : "\n"));
  }
  const next = lines.join("");
  await client.writeWorkspaceFile(workspace, { path, content: next, expectedContent: content });
}
