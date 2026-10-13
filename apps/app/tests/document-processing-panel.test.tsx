import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { DocumentProcessingPanel } from "../src/react-app/domains/session/panel/document-processing-panel";
import { documentClientIdentity, persistDocumentSelection, readDocumentSelection, type FreshDocument } from "../src/react-app/domains/session/panel/document-processing";
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
  expect(html).toContain(t("documents.status_missing")); expect(html).not.toContain(t("documents.status_partial"));
});

test("persisted reload selection includes unprepared original and cannot claim complete extraction", () => {
  const client = createLegalworkServerClient({ baseUrl: "http://reload" });
  const queryClient = new QueryClient();
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const saved = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  } });
  persistDocumentSelection("reload-selection", [source.path, "unprepared.pdf"]);
  const selectedPaths = readDocumentSelection("reload-selection");
  if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
  const identity = [client.baseUrl, documentClientIdentity(client), "selected", "/root"];
  queryClient.setQueryData(["lawoss-documents", ...identity, [...selectedPaths].sort(), "files"], [{ ...source, status: "readable", complete: true }]);
  const html = renderToStaticMarkup(<QueryClientProvider client={queryClient}><DocumentProcessingPanel client={client} workspaceId="selected" projectId="app-selected" workspaceRoot="/root" folder="" selectedPaths={selectedPaths} onSelectPaths={() => {}} fileVersion="files" active={false} isRemote={false} /></QueryClientProvider>);
  expect(html).not.toContain(t("documents.complete"));
  expect(html).toContain("unprepared.pdf");
});

test("real output query success, failed refetch and recovery retract and restore verified status", async () => {
  const client = createLegalworkServerClient({ baseUrl: "http://refetch" });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const identity = [client.baseUrl, documentClientIdentity(client), "selected", "/root"];
  const key = ["lawoss-document-outputs", ...identity, ["source"], "files"];
  queryClient.setQueryData(["lawoss-documents", ...identity, [source.path], "files"], [{ ...source, status: "readable", complete: true }]);
  const output = { path: "report.md", documentIds: ["source"], verified: true, hash: "a", currentHash: "a", sourceHash: "x", currentSourceHash: "x" };
  const html = () => renderToStaticMarkup(<QueryClientProvider client={queryClient}><DocumentProcessingPanel client={client} workspaceId="selected" projectId="app-selected" workspaceRoot="/root" folder="" selectedPaths={[source.path]} onSelectPaths={() => {}} fileVersion="files" active={false} isRemote={false} /></QueryClientProvider>);
  await queryClient.fetchQuery({ queryKey: key, queryFn: async () => [output] });
  expect(html()).toContain(t("documents.output_verified"));
  await expect(queryClient.fetchQuery({ queryKey: key, staleTime: 0, queryFn: async () => { throw new Error("status unavailable"); } })).rejects.toThrow();
  expect(html()).not.toContain(t("documents.output_verified"));
  await queryClient.fetchQuery({ queryKey: key, staleTime: 0, queryFn: async () => [output] });
  expect(html()).toContain(t("documents.output_verified"));
});
