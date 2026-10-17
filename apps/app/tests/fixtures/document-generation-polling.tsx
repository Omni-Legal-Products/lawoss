/** @jsxImportSource react */
import * as React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../src/app/index.css";
import { createLegalworkServerClient } from "../../src/app/lib/legalwork-server";
import { setLanguagePreference } from "../../src/i18n";
import { DocumentProcessingPanel } from "../../src/react-app/domains/session/panel/document-processing-panel";
import type { DocumentGenerationRequest } from "../../src/react-app/domains/session/panel/document-processing";

// The browser regression intercepts this synthetic API. No engine or model is connected.
const api = `${location.origin}/__document_polling_fixture`;
const client = createLegalworkServerClient({ baseUrl: api });
const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
setLanguagePreference("cs");

function Fixture() {
  const [sent, setSent] = React.useState(false);
  const generate = async (request: DocumentGenerationRequest) => {
    const response = await fetch(`${api}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
    if (!response.ok) throw new Error("Synthetic send failed");
    setSent(true);
    return "synthetic-session";
  };
  return <QueryClientProvider client={queries}>
    <main className="mx-auto flex h-screen max-w-lg flex-col bg-background text-foreground">
      <h1 className="p-4">Syntetický test generování · bez klientských dat</h1>
      <DocumentProcessingPanel client={client} workspaceId="synthetic" projectId="synthetic-project" workspaceRoot="/synthetic"
        folder="" selectedPaths={["source.pdf"]} onSelectPaths={() => {}} fileVersion="stable" active isRemote onGenerate={generate} />
      {sent ? <p role="status">Syntetické zadání přijato</p> : null}
    </main>
  </QueryClientProvider>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
