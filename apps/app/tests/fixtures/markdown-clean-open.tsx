/** @jsxImportSource react */
import React, { useCallback, useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import "../../src/app/index.css";
import { setLanguagePreference } from "../../src/i18n";
import { ArtifactMarkdownEditor } from "../../src/react-app/domains/session/artifacts/artifact-markdown-editor";
import { ArtifactMarkdownPanel } from "../../src/react-app/domains/session/artifacts/artifact-markdown-panel";
import { confirmDiscardDocuments } from "../../src/react-app/domains/session/artifacts/docx-document-state";
import type { LegalworkServerClient } from "../../src/app/lib/legalwork-server";

// Handwritten test data only. Bare URL/email trigger MDXEditor's late AutoLink transform.
const original = "---\nid: SYNTHETIC\ntype: fact\nsources:\n  - title: Test source\n    status: unverified\n---\n\n## Truth\n\nTest www.example.org and sample@example.org.[reference]\n\n[Explicit link](https://example.org/explicit)\n\n* original bullet\n\n## History\n\n";
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
let disk = original;
let reads = 0;
let writes = 0;
let revision = 1;
const client = {
  readWorkspaceFile: async () => { reads++; return { content: disk, updatedAt: revision }; },
  writeWorkspaceFile: async (_workspace: string, input: { content: string }) => {
    writes++; disk = input.content; revision++;
    return { ok: true, content: disk, updatedAt: revision };
  },
};
const panel = new URLSearchParams(location.search).has("panel");
const readOnly = new URLSearchParams(location.search).has("readonly");
const observed = { original, changes: [] as string[], value: original, baseline: original };

function Fixture() {
  const [value, setValue] = useState(original);
  const [baseline, setBaseline] = useState(original);
  const [, setVersion] = useState(0);
  const onChange = useCallback((next: string) => { observed.changes.push(next); observed.value = next; setValue(next); }, []);
  const upload = useCallback(async (): Promise<string> => { throw Error("Image writes are forbidden in this fixture"); }, []);
  const preview = useCallback(async (source: string) => source, []);
  Object.assign(window, { markdownCleanOpen: {
    snapshot: () => ({ ...observed, changes: [...observed.changes], dirty: panel ? !confirmDiscardDocuments(undefined, () => false) : observed.value !== observed.baseline, disk, reads, writes }),
    refetch: () => queryClient.invalidateQueries({ queryKey: ["markdown-editor"] }),
    focus: () => { focusManager.setFocused(false); focusManager.setFocused(true); },
    refresh: () => setVersion(n => n + 1),
    replace: (next: string) => { observed.value = next; observed.baseline = next; setValue(next); setBaseline(next); },
    save: () => { observed.baseline = observed.value; setBaseline(observed.value); },
    replaceDisk: async (next: string) => { disk = next; revision++; await queryClient.invalidateQueries({ queryKey: ["markdown-editor"] }); },
  } });
  return <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <header style={{ padding: 16 }}><strong>Syntetický Markdown · žádná klientská data</strong></header>
    <div style={{ flex: 1, minHeight: 0 }}>{panel ? <QueryClientProvider client={queryClient}>
      {/* The fixture implements only file reads/writes; no model/server is connected. */}
      <ArtifactMarkdownPanel sessionId="synthetic-session" client={client as unknown as LegalworkServerClient} workspaceId="synthetic-workspace" workspaceRoot="/synthetic" isRemoteWorkspace localReadOnly={readOnly} target={{ id: "synthetic-record", kind: "file", value: "memory/synthetic.md", name: "Syntetický záznam.md", preview: "markdown", confidence: 1, reason: "test" }} onClose={() => {}} />
    </QueryClientProvider> : <ArtifactMarkdownEditor value={value} baseline={baseline} readOnly={readOnly} onChange={onChange} imageUpload={upload} imagePreview={preview} />}</div>
  </div>;
}

setLanguagePreference("cs");
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><Fixture /></React.StrictMode>);
