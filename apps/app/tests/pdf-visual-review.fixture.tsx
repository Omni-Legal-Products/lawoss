import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { LocalProvider } from "../src/react-app/kernel/local-provider";
import { LegalworkControlProvider } from "../src/react-app/shell/control/control-provider";
import { ArtifactPanel } from "../src/react-app/domains/session/artifacts/artifact-panel";
import { DocumentRuntimeProvider, useDocumentRuntime } from "../src/react-app/domains/session/artifacts/document-runtime";
import { DocumentProcessingPanel } from "../src/react-app/domains/session/panel/document-processing-panel";
import { usePanelTabStore } from "../src/react-app/domains/session/panel/panel-tab-store";
import { setLocale } from "../src/i18n";
import "../src/app/index.css";

/** Real persistent PDF owner + document panel. Only the owned HTTP read can be
 * held to expose the interval before its fresh bytes reach the actual iframe. */
export function mountPdfVisualReviewFixture(baseUrl: string, workspaceRoot: string) {
  setLocale("en");
  const previousSessions = usePanelTabStore.getState().sessions;
  const previousDark = document.documentElement.classList.contains("dark"); document.documentElement.classList.add("dark");
  const descriptors = ["__legalwork", "__legalworkControl"].map(name => [name, Object.getOwnPropertyDescriptor(window, name)] as const);
  const client = createLegalworkServerClient({ baseUrl, hostToken: "synthetic-host" });
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const originalDownload = client.downloadWorkspaceFile;
  let release = () => {};
  let held: Promise<void> | null = null;
  let downloadEntered = false;
  let firstDownload: Awaited<ReturnType<typeof originalDownload>> | undefined;
  let replayFirst = false;
  client.downloadWorkspaceFile = async (...args) => {
    if (args[0] !== "visual" || args[1] !== "border.pdf") throw new Error("Unexpected synthetic viewer scope");
    const result = await originalDownload(...args);
    firstDownload ??= result;
    if (held) { downloadEntered = true; await held; held = null; }
    if (replayFirst) { replayFirst = false; return firstDownload; }
    return result;
  };
  const scope = "workspace:visual";
  const open = () => usePanelTabStore.getState().openTab(scope, { id: "file:border.pdf", type: "artifact", label: "border.pdf", preview: "pdf", value: "border.pdf" });
  open();
  let runtime: ReturnType<typeof useDocumentRuntime> = null;
  let originalHost: HTMLElement | undefined;
  function Mounted() {
    const owner = useDocumentRuntime();
    useEffect(() => { runtime = owner; });
    const tabs = usePanelTabStore(state => state.sessions[scope]?.tabs ?? []);
    const tab = tabs.find(tab => tab.type === "artifact");
    return <div className="dark" style={{ display: "flex", height: 850, width: 1450, background: "#090e14", color: "white" }}>
      <div style={{ width: 700 }}><DocumentProcessingPanel client={client} workspaceId="visual" projectId="visual" workspaceRoot={workspaceRoot} folder="" selectedPaths={["border.pdf"]} onSelectPaths={() => {}} active={true} isRemote={false} fileVersion="synthetic" onOpenSource={open} /></div>
      <div style={{ width: 750, height: 850 }}>{tab?.type === "artifact" && <ArtifactPanel sessionId={scope} tab={tab} client={client} workspaceId="visual" workspaceRoot={workspaceRoot} onClose={() => {}} />}</div>
    </div>;
  }
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
  flushSync(() => root.render(<MemoryRouter><QueryClientProvider client={queries}><LocalProvider><LegalworkControlProvider><DocumentRuntimeProvider><Mounted /></DocumentRuntimeProvider></LegalworkControlProvider></LocalProvider></QueryClientProvider></MemoryRouter>));
  return {
    rememberOwner() { originalHost = [...(runtime?.entries.values() ?? [])][0]?.host; if (!originalHost) throw new Error("Missing actual persistent owner"); },
    ownerRetained() { return Boolean(originalHost && [...(runtime?.entries.values() ?? [])][0]?.host === originalHost && usePanelTabStore.getState().sessions[scope].tabs.length === 1); },
    holdDownload() { downloadEntered = false; held = new Promise<void>(resolve => { release = resolve; }); },
    downloadEntered() { return downloadEntered; },
    releaseDownload() { release(); },
    replayFirstDownload() { replayFirst = true; },
    refreshSources: () => queries.invalidateQueries({ queryKey: ["lawoss-documents"] }),
    dispose() {
      release(); flushSync(() => root.unmount()); host.remove(); queries.clear(); usePanelTabStore.setState({ sessions: previousSessions });
      if (!previousDark) document.documentElement.classList.remove("dark");
      for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(window, name, descriptor); else Reflect.deleteProperty(window, name); }
    },
  };
}
