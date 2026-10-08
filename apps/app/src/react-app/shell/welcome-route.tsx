/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { createLegalworkServerClient, type LegalworkServerClient } from "@/app/lib/legalwork-server";
import { resolveWorkspaceListSelectedId, workspaceCreate, workspaceSetRuntimeActive, workspaceSetSelected } from "@/app/lib/desktop";
import { canonicalDirectoryPath, pickDirectory } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { resolveLegalworkConnection } from "./legalwork-connection";
import { installMissingOnboardingSkills } from "@/lawoss/domains/onboarding/install-pack";
import { ensureDesktopLocalLegalworkConnection } from "./desktop-local-legalwork";
import { homeRoute } from "./workspace-routes";
import { writeActiveWorkspaceId } from "./session-memory";
import { useLocal } from "../kernel/local-provider";
import { LawossWelcomePage } from "@/lawoss/domains/onboarding/lawoss-welcome-page";
import type { OnboardingStep } from "@/lawoss/domains/onboarding/api";
import { authorAfterOnboarding } from "@/lawoss/okf/lawyer-name";
import { markAllWhatsNewSeen } from "./whats-new";
import { canonicalPathOf, withCanonicalPaths } from "@/lawoss/domains/onboarding/typed-paths";

// 🟡 LAWOSS: napísané a vložené cesty idú na server v tvare ako vybrané v dialógu (Windows, typed-paths.ts); v prehliadači bez zmeny.
const typedPaths = (client: LegalworkServerClient) => isDesktopRuntime() ? withCanonicalPaths(client, canonicalDirectoryPath) : client;
const workingFolderPath = (value: string) => isDesktopRuntime() ? canonicalPathOf(value, canonicalDirectoryPath) : Promise.resolve(value);

// LAWOSS: pripojenie priečinka (aj staré `existing` a `okf`) otvorí krok Priečinok; `root` rovno „Toto som našiel“.
const continuationStep = (value: string | null): OnboardingStep | undefined =>
  value === "existing" || value === "okf" || value === "folder" ? "folder" : value === "client" || value === "matter" ? value : undefined;

async function registerWorkingFolder(client: LegalworkServerClient, folderPath: string) {
  const list = await client.createLocalWorkspace({ folderPath, name: folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath, preset: "starter", registerExisting: true });
  const workspace = list.workspaces.find(item => item.path === folderPath) ?? list.workspaces.find(item => item.id === resolveWorkspaceListSelectedId(list));
  if (!workspace) throw new Error("Working folder registration did not return a workspace.");
  return { id: workspace.id, path: workspace.path, displayName: workspace.displayName ?? workspace.name };
}

/** Native LAWOSS onboarding. Office is configuration only, client is always the workspace. */
export function WelcomeRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const local = useLocal();
  const [client, setClient] = useState<LegalworkServerClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const continuation = new URLSearchParams(location.search).get("continue");
  const initialStep = continuationStep(continuation);
  // LAWOSS: ako upstream pri štarte onboardingu; novému používateľovi je nové všetko, „What's new“ nie.
  useEffect(() => { if (!local.prefs.hasCompletedOnboarding) markAllWhatsNewSeen(); }, []);

  useEffect(() => {
    let cancelled = false;
    void resolveLegalworkConnection().then(({ normalizedBaseUrl, resolvedToken, resolvedHostToken }) => {
      if (!normalizedBaseUrl || !(resolvedToken || resolvedHostToken)) throw new Error("LAWOSS server is unavailable");
      if (!cancelled) setClient(typedPaths(createLegalworkServerClient({ baseUrl: normalizedBaseUrl, token: resolvedToken || undefined, hostToken: resolvedHostToken || undefined })));
    }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <main className="mx-auto max-w-xl p-10"><p role="alert">{error}</p><Button className="mt-4" onClick={() => navigate("/settings/advanced")}>Open Settings</Button></main>;
  if (!client) return <main className="mx-auto max-w-xl p-10" role="status">Connecting LAWOSS…</main>;
  return <LawossWelcomePage api={client} initialStep={initialStep} initialRoot={new URLSearchParams(location.search).get("root") ?? undefined} pickDirectory={async () => { const result = await pickDirectory({ title: "Select LAWOSS folder", canonical: true }); return typeof result === "string" ? result : null; }} onOpenAiSettings={() => navigate("/settings/ai")} onComplete={async (result, completion) => {
    const status = await client.onboardingStatus();
    const okf = status.profile?.okf?.enabled === true;
    const list = await client.listWorkspaces();
    // LAWOSS: pracovný priečinok bez výsledku klienta (celá prax ako jeden priečinok, voliteľný priečinok bez OKF) sa zaregistruje tak, ako je.
    const plain = !result?.workspace && completion?.workingFolder ? await registerWorkingFolder(client, await workingFolderPath(completion.workingFolder)) : undefined;
    const workspace = result?.workspace ?? plain ?? list.items.find(item => item.path === status.profile?.clientRoot);
    let activeId = workspace?.id;
    if (workspace && isDesktopRuntime()) {
      const existing = list.items.find(item => item.id === workspace.id);
      const nativeList = await workspaceCreate({ folderPath: workspace.path, name: workspace.displayName ?? existing?.name ?? workspace.path.split(/[\\/]/).pop() ?? "Client", preset: "starter", registerExisting: true, appFiles: result?.appFiles ?? existing?.appFiles });
      const native = nativeList.workspaces.find(item => item.path === workspace.path);
      if (!native || native.id !== workspace.id) throw new Error("Client registration did not preserve workspace identity.");
      await workspaceSetSelected(native.id);
      await workspaceSetRuntimeActive(native.id);
      await ensureDesktopLocalLegalworkConnection({ route: "session", workspace: native, allWorkspaces: nativeList.workspaces });
      activeId = native.id;
    }
    if (activeId) {
      const connection = await resolveLegalworkConnection();
      const activeClient = createLegalworkServerClient({ baseUrl: connection.normalizedBaseUrl, token: connection.resolvedToken, hostToken: connection.resolvedHostToken });
      await activeClient.activateWorkspace(activeId, { persist: true });
      if (okf) await installMissingOnboardingSkills(activeClient, activeId, status.profile?.language ?? "sk");
      writeActiveWorkspaceId(activeId);
    }
    local.setPrefs((previous) => ({ ...previous, documentAuthor: authorAfterOnboarding(previous.documentAuthor, status.profile?.lawyerName), hasCompletedOnboarding: true }));
    navigate(activeId ? homeRoute(activeId) : "/home", { replace: true });
  }} />;
}
