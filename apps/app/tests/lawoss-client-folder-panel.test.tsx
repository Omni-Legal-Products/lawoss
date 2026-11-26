import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ClientFolderPanel, summarizeFolder } from "../src/lawoss/lite/client-folder-panel";
import type { LegalworkWorkspaceDirectoryList } from "@/app/lib/legalwork-server";

const listing: LegalworkWorkspaceDirectoryList = {
  path: "", truncated: true,
  entries: [
    ...["notes.md", "AGENTS.md", ".private.md", "index.md", "~$draft.docx", "exhibit.pdf"].map(name => ({ kind: "file" as const, path: name, name })),
    { kind: "dir", path: "Research", name: "Research" },
  ],
};
test("a folder without case cards exposes source documents separately from recorded cases", () => {
  const summary = summarizeFolder(listing);
  expect([summary.files, summary.markdown, summary.folders]).toEqual([4, 3, 1]);
  expect(summary.documents.map(file => file.name)).toEqual(["index.md", "AGENTS.md", "notes.md"]);
  const html = renderToStaticMarkup(<MemoryRouter><ClientFolderPanel projectId="example" root="/Clients/A & B" listing={listing} onOpen={() => {}} onRefresh={async () => {}} /></MemoryRouter>);
  expect(html).toContain("Files: 4");
  expect(html).toContain("Find and register cases");
  expect(html).toContain("root=%2FClients%2FA%20%26%20B");
  expect(html).not.toContain(".private.md");
});
