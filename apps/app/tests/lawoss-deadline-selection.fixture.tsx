/** Mounted only by the explicit owned Chromium deadline selection check. */
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { ScopedWorkflow } from "../src/lawoss/domains/lehoty/deadline-review";
const client = createLegalworkServerClient({ baseUrl: location.origin, token: "synthetic-selection-owner" });
const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const root = createRoot(document.getElementById("fixture")!);
root.render(<QueryClientProvider client={cache}><ScopedWorkflow client={client} owner={{baseUrl:location.origin,token:"synthetic-selection-owner",authGeneration:0,scopeKey:"synthetic",workspaceId:"synthetic",matterPath:"case"}} jurisdiction="cz" locale="cs" /></QueryClientProvider>);
window.addEventListener("pagehide",()=>{root.unmount();cache.clear();},{once:true});
