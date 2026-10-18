import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { DocumentProcessingPanel } from "../src/react-app/domains/session/panel/document-processing-panel";
import { documentClientIdentity, persistDocumentSelection, readDocumentSelection, type FreshDocument } from "../src/react-app/domains/session/panel/document-processing";
import { t } from "../src/i18n";

const source: FreshDocument = { id: "source", path: '<img src=x onerror="unsafe">.pdf', workspaceId: "selected", hash: "a", status: "partial", complete: false, pageCount: 2, readablePages: 1, updatedAt: 1, provenance: { sourcePath: "source.pdf", depth: 0 }, freshness: "current", pages: [{ page: 1, text: "<script>unsafe</script>" }] };
function generateButtonAttributes(html: string) {
  const button = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].find(button => button[2].includes(t("documents.generate")));
  expect(button).toBeDefined();
  return button![1];
}
function render(records: FreshDocument[], baseUrl = "http://fixture", hostToken?: string) {
  const client = createLegalworkServerClient({ baseUrl, hostToken });
  const queryClient = new QueryClient();
  const identity = [baseUrl, documentClientIdentity(client), "selected", "/root"];
  queryClient.setQueryData(["lawoss-documents", ...identity, [source.path], "files"], records);
  queryClient.setQueryData(["lawoss-document-outputs", ...identity, ["source"], "files"], [{ path: "report.md", kind: "summary", sourceKind: "workspace", outputLanguage: "en", documentIds: ["source"], hash: "a", currentHash: "b", sourceHash: "x", currentSourceHash: "x", verified: true, legalApproval: false }]);
  return renderToStaticMarkup(<QueryClientProvider client={queryClient}><DocumentProcessingPanel client={client} workspaceId="selected" projectId="app-selected" workspaceRoot="/root" folder="" selectedPaths={[source.path]} onSelectPaths={() => {}} fileVersion="files" active={false} isRemote={false} onGenerate={async () => "session"} /></QueryClientProvider>);
}

test("native source panel separates text coverage from visual attestation and requires host confirmation", () => {
  const pending: FreshDocument = { ...source, pdfCoverage: [{ page: 1, nativeTextCoverage: "complete", visualReasons: ["drawn-paths"] }] };
  const owner = render([pending]);
  expect(owner).toContain(t("documents.visual_host_required"));
  expect(owner).not.toContain('type="checkbox"');
  const host = render([pending], "http://fixture", "synthetic-host");
  expect(host).toContain(t("documents.visual_confirm")); expect(host).toContain('type="checkbox"');
  expect(host).toContain(t("documents.visual_review"));
  const submit = [...host.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].find(button => button[2].includes(t("documents.visual_review")));
  expect(submit?.[1]).toMatch(/disabled/);
  const unknown = render([{ ...pending, pdfCoverage: [{ page: 1, nativeTextCoverage: "complete", visualReasons: ["images", "drawn-paths"] }] }], "http://fixture", "synthetic-host");
  expect(unknown).toContain(t("documents.visual_other_content")); expect(unknown).not.toContain('type="checkbox"');
  const child = render([{ ...pending, provenance: { ...pending.provenance, parentId: "container", attachmentName: "embedded.pdf" } }], "http://fixture", "synthetic-host");
  expect(child).toContain(t("documents.visual_attachment_required")); expect(child).not.toContain('type="checkbox"');
});

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
  for (const unavailable of [html, stale, render([{ ...source, freshness: "error" }]), render([])]) {
    expect(generateButtonAttributes(unavailable)).toMatch(/\sdisabled(?:=|\s|$)/);
  }
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

test("background source verification keeps generation available without presenting cached output as verified", async () => {
  const client = createLegalworkServerClient({ baseUrl: "http://background-verification" });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const identity = [client.baseUrl, documentClientIdentity(client), "selected", "/root"];
  const key = ["lawoss-documents", ...identity, [source.path], "files"];
  queryClient.setQueryData(key, [source]);
  queryClient.setQueryData(["lawoss-document-outputs", ...identity, ["source"], "files"], [{ path: "report.md", documentIds: ["source"], verified: true, hash: "a", currentHash: "a", sourceHash: "x", currentSourceHash: "x" }]);
  let finish = () => {};
  const refresh = queryClient.fetchQuery({ queryKey: key, queryFn: () => new Promise<FreshDocument[]>(resolve => {
    finish = () => resolve([source]);
  }) });
  try {
    const html = renderToStaticMarkup(<QueryClientProvider client={queryClient}><DocumentProcessingPanel client={client} workspaceId="selected" projectId="app-selected" workspaceRoot="/root" folder="" selectedPaths={[source.path]} onSelectPaths={() => {}} fileVersion="files" active={false} isRemote={false} onGenerate={async () => "session"} /></QueryClientProvider>);
    expect(generateButtonAttributes(html)).not.toMatch(/\sdisabled(?:=|\s|$)/);
    expect(html).toContain(t("documents.checking"));
    expect(html).not.toContain(t("documents.output_verified"));
  } finally {
    finish(); await refresh; queryClient.clear();
  }
});

test("failed source refresh blocks cached generation until successful recovery", async () => {
  const client = createLegalworkServerClient({ baseUrl: "http://failed-source-refresh" });
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ["lawoss-documents", client.baseUrl, documentClientIdentity(client), "selected", "/root", [source.path], "files"];
  const html = () => renderToStaticMarkup(<QueryClientProvider client={queries}><DocumentProcessingPanel client={client} workspaceId="selected" projectId="app-selected" workspaceRoot="/root" folder="" selectedPaths={[source.path]} onSelectPaths={() => {}} fileVersion="files" active={false} isRemote={false} onGenerate={async () => "session"} /></QueryClientProvider>);
  try {
    queries.setQueryData(key, [source]);
    await expect(queries.fetchQuery({ queryKey: key, queryFn: async () => { throw new Error("Synthetic source unavailable"); } })).rejects.toThrow();
    expect(generateButtonAttributes(html())).toMatch(/\sdisabled(?:=|\s|$)/);
    await queries.fetchQuery({ queryKey: key, queryFn: async () => [source] });
    expect(generateButtonAttributes(html())).not.toMatch(/\sdisabled(?:=|\s|$)/);
  } finally {
    queries.clear();
  }
});
