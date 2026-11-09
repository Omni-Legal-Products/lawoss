/** @jsxImportSource react */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { FileStorageView } from "../src/react-app/domains/settings/pages/file-storage-view";
import { HubScopeContext } from "../src/react-app/domains/settings/pages/hub-scope-context";
import { StorageDriveTree } from "../src/react-app/domains/session/panel/storage-drive-tree";
import { storageInputSchema } from "@legalwork/types/file-storage";
import { connectorStatusSchema } from "@legalwork/types/connectors";

const client = createLegalworkServerClient({ baseUrl: "http://localhost:1", token: "synthetic", hostToken: "synthetic-host" });
function cache() {
  const value = new QueryClient();
  value.setQueryData(["storage-connections", "workspace"], { connections: [{ id: "connector:google-drive:account", name: "Google Drive", config: { kind: "oauth", provider: "google-drive", accountId: "account", root: "" }, readOnly: true, enabled: true, updatedAt: 0, configuredSecrets: [] }] });
  value.setQueryData(["storage-oauth-providers", "workspace"], { providers: [{ id: "box", name: "Box", rootHint: "" }, { id: "dropbox", name: "Dropbox", rootHint: "" }] });
  return value;
}
test("File Storage shows a native account once and keeps unconnected providers in the Add picker", () => {
  const queryClient = cache();
  const html = renderToStaticMarkup(<QueryClientProvider client={queryClient}><FileStorageView client={client} workspaceId="workspace" /></QueryClientProvider>);
  expect(html.match(/>Google Drive</g)).toHaveLength(1);
  expect(html).toContain("/ext-googledrive.svg");
  for (const name of ["OneDrive for work or school", "SharePoint", "Box", "Dropbox", "WebDAV", "SFTP", "FTP"]) expect(html).not.toContain(`>${name}<`);
  expect(html).not.toContain("Edit Google Drive"); expect(html).not.toContain("Disconnect Google Drive"); expect(html).not.toMatch(/<img[^>]+src="https?:/);
  queryClient.clear();
});
test("personal native cloud setup does not appear in the team storage tab", () => {
  const queryClient = cache();
  const html = renderToStaticMarkup(<QueryClientProvider client={queryClient}><HubScopeContext.Provider value="team"><FileStorageView client={client} workspaceId="workspace" /></HubScopeContext.Provider></QueryClientProvider>);
  expect(html).not.toContain("Google Drive"); expect(html).not.toContain("Add a folder or library"); queryClient.clear();
});
for (const scenario of [
  { name: "installed member storage without an account needs sign-in", mode: "member", accounts: [], needsSignIn: true },
  { name: "installed member storage with expired sign-in needs attention", mode: "member", accounts: [{ id: "account", createdAt: null, needsReconnect: true }], needsSignIn: true },
  { name: "member storage reuses a valid own-app account without platform sign-in", mode: "member", accounts: [{ id: "account", createdAt: null, needsReconnect: false, source: "custom" }], needsSignIn: false },
  { name: "shared team account does not require the member's personal sign-in", mode: "team", accounts: [], needsSignIn: false },
]) test(scenario.name, () => {
  const queryClient = cache();
  queryClient.setQueryData(["storage-connections", "workspace"], { connections: [{
    ...storageInputSchema.parse({ name: "Company Drive", config: { kind: "oauth", provider: "google-drive", root: "", sharingMode: scenario.mode } }),
    id: "team:drive", updatedAt: 1, configuredSecrets: [], team: { orgId: "firm", version: 1, installed: true },
  }] });
  queryClient.setQueryData(["storage-native-accounts", "workspace"], connectorStatusSchema.parse({
    configured: false, requiresSignIn: true, connectors: [{ id: "google-drive", name: "Google Drive", configured: false, connections: scenario.accounts }],
  }));
  const html = renderToStaticMarkup(<QueryClientProvider client={queryClient}><FileStorageView client={client} workspaceId="workspace" /></QueryClientProvider>);
  expect(html).toContain("Company Drive");
  expect(html.includes("Sign in to use it")).toBe(scenario.needsSignIn);
  queryClient.clear();
});
test("Memory Drive uses bundled provider marks and preserves read-only root controls", () => {
  const queryClient = new QueryClient();
  const html = renderToStaticMarkup(<QueryClientProvider client={queryClient}><StorageDriveTree client={client} workspaceId="workspace" roots={[{ id: "cloud", name: "Google Drive", kind: "oauth", provider: "google-drive", writable: false }]} onOpenFile={() => {}} /></QueryClientProvider>);
  expect(html).toContain("Google Drive"); expect(html).toContain("/ext-googledrive.svg"); expect(html).not.toContain("https://"); expect(html).toContain("disabled"); queryClient.clear();
});
