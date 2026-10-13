import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { DocumentProcessingPanel } from "../src/react-app/domains/session/panel/document-processing-panel";
import { documentClientIdentity, type FreshDocument } from "../src/react-app/domains/session/panel/document-processing";
import { t } from "../src/i18n";

const source: FreshDocument = { id: "source", path: '<img src=x onerror="unsafe">.pdf', workspaceId: "selected", hash: "a", status: "partial", complete: false, pageCount: 2, readablePages: 1, updatedAt: 1, provenance: { sourcePath: "source.pdf", depth: 0 }, freshness: "current", pages: [{ page: 1, text: "<script>unsafe</script>" }] };
function render(records: FreshDocument[], baseUrl = "http://fixture") {
  const client = createLegalworkServerClient({ baseUrl });
  const queryClient = new QueryClient();
  const identity = [baseUrl, documentClientIdentity(client), "selected", "/root"];
  queryClient.setQueryData(["lawoss-documents", ...identity, [source.path], "files"], records);
  queryClient.setQueryData(["lawoss-document-outputs", ...identity, ["source"], "files"], [{ path: "report.md", kind: "summary", sourceKind: "workspace", outputLanguage: "en", documentIds: ["source"], hash: "a", currentHash: "b", sourceHash: "x", currentSourceHash: "x", verified: true, legalApproval: false }]);
  return renderToStaticMarkup(<QueryClientProvider client={queryClient}><DocumentProcessingPanel client={client} workspaceId="selected" projectId="app-selected" workspaceRoot="/root" folder="" selectedPaths={[source.path]} onSelectPaths={() => {}} fileVersion="files" active={false} isRemote={false} onGenerate={async () => "session"} /></QueryClientProvider>);
}

test("React source UI escapes original names, shows incomplete OCR and never treats edited output as verified", () => {
  const html = render([source]);
  expect(html).toContain("&lt;img"); expect(html).not.toContain('<img src="x"');
  expect(html).toContain(t("documents.status_partial"));
  expect(html).toContain(t("documents.incomplete"));
  expect(html).toContain(t("documents.output_edited"));
  expect(html).not.toContain(t("documents.output_verified"));
  expect(html).toContain(t("documents.not_legal_approval"));
});

test("React upload/stale state is distinct from readable and cannot enable generation", () => {
  const html = render([{ ...source, status: "uploaded", freshness: "pending", readablePages: 0 }]);
  expect(html).toContain(t("documents.pending"));
  expect(html).not.toContain(t("documents.status_readable"));
  expect(html).not.toContain(t("documents.output_verified"));
  const stale = render([{ ...source, freshness: "stale" }]);
  expect(stale).toContain(t("documents.stale"));
});

test("React query identity cannot reuse another owning client with the same runtime project id", () => {
  const prior = createLegalworkServerClient({ baseUrl: "http://prior-owner" });
  const next = createLegalworkServerClient({ baseUrl: "http://next-owner" });
  const queryClient = new QueryClient();
  queryClient.setQueryData(["lawoss-documents", prior.baseUrl, documentClientIdentity(prior), "selected", "/root", [source.path], "files"], [source]);
  const html = renderToStaticMarkup(<QueryClientProvider client={queryClient}><DocumentProcessingPanel client={next} workspaceId="selected" projectId="app-selected" workspaceRoot="/root" folder="" selectedPaths={[source.path]} onSelectPaths={() => {}} fileVersion="files" active={false} isRemote={true} /></QueryClientProvider>);
  expect(html).not.toContain("&lt;img"); expect(html).not.toContain(t("documents.status_partial"));
});
