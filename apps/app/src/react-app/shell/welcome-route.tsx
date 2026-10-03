/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { createLegalworkServerClient, type LegalworkServerClient } from "@/app/lib/legalwork-server";
import { workspaceCreate, workspaceSetRuntimeActive, workspaceSetSelected } from "@/app/lib/desktop";
import { pickDirectory } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { resolveLegalworkConnection } from "./legalwork-connection";
import { installMissingOnboardingSkills } from "@/lawoss/domains/onboarding/install-pack";
import { ensureDesktopLocalLegalworkConnection } from "./desktop-local-legalwork";
import { homeRoute } from "./workspace-routes";
import { writeActiveWorkspaceId } from "./session-memory";
import { useLocal } from "../kernel/local-provider";
import { LawossWelcomePage } from "@/lawoss/domains/onboarding/lawoss-welcome-page";
import type { OnboardingStep } from "@/lawoss/domains/onboarding/api";

const continuationStep = (value: string | null): OnboardingStep | undefined => value === "client" || value === "matter" ? value : undefined;

/** Native LAWOSS onboarding. Office is configuration only, client is always the workspace. */
export function WelcomeRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const local = useLocal();
  const [client, setClient] = useState<LegalworkServerClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initialStep = continuationStep(new URLSearchParams(location.search).get("continue"));

  useEffect(() => {
    let cancelled = false;
    void resolveLegalworkConnection().then(({ normalizedBaseUrl, resolvedToken, resolvedHostToken }) => {
      if (!normalizedBaseUrl || !(resolvedToken || resolvedHostToken)) throw new Error("LAWOSS server is unavailable");
      if (!cancelled) setClient(createLegalworkServerClient({ baseUrl: normalizedBaseUrl, token: resolvedToken || undefined, hostToken: resolvedHostToken || undefined }));
    }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <main className="mx-auto max-w-xl p-10"><p role="alert">{error}</p><Button className="mt-4" onClick={() => navigate("/settings/advanced")}>Open Settings</Button></main>;
  if (!client) return <main className="mx-auto max-w-xl p-10" role="status">Connecting LAWOSS…</main>;
  return <LawossWelcomePage api={client} initialStep={initialStep} pickDirectory={async () => { const result = await pickDirectory({ title: "Select LAWOSS folder" }); return typeof result === "string" ? result : null; }} onOpenAiSettings={() => navigate("/settings/ai")} onComplete={async (result) => {
    const status = await client.onboardingStatus();
    const list = await client.listWorkspaces();
    const workspace = result?.workspace ?? list.items.find(item => item.path === status.profile?.clientRoot);
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
      await installMissingOnboardingSkills(activeClient, activeId, status.profile?.language ?? "sk");
      writeActiveWorkspaceId(activeId);
    }
    local.setPrefs((previous) => ({ ...previous, hasCompletedOnboarding: true }));
    navigate(activeId ? homeRoute(activeId) : "/home", { replace: true });
  }} />;
}
