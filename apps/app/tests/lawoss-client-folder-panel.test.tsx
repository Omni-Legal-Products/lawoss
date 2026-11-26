import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createLegalworkServerClient } from "@/app/lib/legalwork-server";
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
  const html = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ClientFolderPanel workspaceId="example" client={createLegalworkServerClient({baseUrl:"http://localhost"})} projectId="example" root="/Clients/A & B" listing={listing} onOpen={() => {}} onRefresh={async () => {}} /></MemoryRouter></QueryClientProvider>);
  expect(html).toContain("Indexing folder");
  expect(html).toContain("/Clients/A &amp; B");
  expect(html).not.toContain("Find and register cases");
  expect(html).not.toContain(".private.md");
});
