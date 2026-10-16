// Manual review fixture. Start the matching real server script first.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { SidePanel } from "../src/react-app/domains/session/panel/side-panel";
import { usePanelTabStore } from "../src/react-app/domains/session/panel/panel-tab-store";
import { classifyOpenTarget } from "../src/react-app/domains/session/artifacts/open-target";
import { LegalworkControlProvider } from "../src/react-app/shell/control/control-provider";
import { DocumentDiscardDialog } from "../src/react-app/domains/session/artifacts/document-discard-dialog";
import { Toaster } from "../src/components/ui/sonner";
import { Button } from "../src/components/ui/button";
import { initLocale } from "../src/i18n";
import "../src/app/index.css";

initLocale();
const client = createLegalworkServerClient({ baseUrl: "http://127.0.0.1:5185", token: "code-editor-review-client" });
const sessionId = "code-editor-review";
const queryClient = new QueryClient();
const files = ["matter.ts", "config.json", "review.py", "Notes.md", "Plain.txt"];
function open(name: string) {
  usePanelTabStore.getState().openTab(sessionId, { id: `file:${name}`, type: "artifact", label: name, value: name, preview: classifyOpenTarget(name, "file") });
  usePanelTabStore.getState().keepTab(sessionId, `file:${name}`);
}
if (!usePanelTabStore.getState().sessions[sessionId]?.tabs.length) {
  for (const name of files) open(name);
  open("matter.ts");
}
function Review() {
  const [dark, setDark] = useState(false);
  return <div className="flex h-screen bg-background text-foreground">
    <aside className="w-56 shrink-0 space-y-3 border-r border-border p-5">
      <h1 className="text-sm font-semibold">Editor review</h1>
      <p className="text-xs text-muted-foreground">Disposable files, real workspace API.</p>
      {files.map(name => <Button key={name} variant="ghost" className="w-full justify-start" onClick={() => open(name)}>{name}</Button>)}
      <Button variant="outline" onClick={() => { document.documentElement.classList.toggle("dark", !dark); setDark(!dark); }}>{dark ? "Light theme" : "Dark theme"}</Button>
    </aside>
    <main className="min-w-0 flex-1"><SidePanel sessionId={sessionId} client={client} workspaceId={sessionId} workspaceRoot="" isRemoteWorkspace onClose={() => {}} /></main>
    <Toaster /><DocumentDiscardDialog />
  </div>;
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><MemoryRouter><QueryClientProvider client={queryClient}><LegalworkControlProvider><Review /></LegalworkControlProvider></QueryClientProvider></MemoryRouter></StrictMode>);
