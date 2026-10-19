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
import type { OnboardingApplyResult, OnboardingStep } from "@/lawoss/domains/onboarding/api";
import type { OnboardingCompletion } from "@/lawoss/domains/onboarding/lawoss-welcome-page";
import { authorAfterOnboarding } from "@/lawoss/okf/lawyer-name";
import { markAllWhatsNewSeen } from "./whats-new";
import { canonicalPathOf, withCanonicalPaths } from "@/lawoss/domains/onboarding/typed-paths";
import { watchLegalworkConnection } from "@/lawoss/domains/onboarding/server-connection";
import { registerOnboardedWorkspace } from "@/lawoss/domains/onboarding/register-clients";

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

  // 🟡 LAWOSS: pri prvom štarte počká, kým boot spustí server (server-connection.ts), namiesto okamžitej chyby.
  useEffect(() => watchLegalworkConnection({
    resolve: resolveLegalworkConnection,
    onReady: ({ normalizedBaseUrl, resolvedToken, resolvedHostToken }) => setClient(typedPaths(createLegalworkServerClient({ baseUrl: normalizedBaseUrl, token: resolvedToken || undefined, hostToken: resolvedHostToken || undefined }))),
    onUnavailable: setError,
  }), []);

  if (error) return <main className="mx-auto max-w-xl p-10"><p role="alert">{error}</p><Button className="mt-4" onClick={() => navigate("/settings/advanced")}>Open Settings</Button></main>;
  if (!client) return <main className="mx-auto max-w-xl p-10" role="status">Connecting LAWOSS…</main>;
  // 🟡 LAWOSS: registrácia, výber a aktivácia pripojeného priečinka (register-clients.ts); volá sa už pred
  // usporiadaním (onRegister), aby prerušené usporiadanie priečinok nestratilo, a znova pri dokončení.
  const register = async (result?: OnboardingApplyResult, completion?: OnboardingCompletion) => {
    const status = await client.onboardingStatus();
    const registered = await registerOnboardedWorkspace({
      desktop: isDesktopRuntime(),
      profileClientRoot: status.profile?.clientRoot,
      listWorkspaces: () => client.listWorkspaces(),
      registerWorkingFolder: async (path) => registerWorkingFolder(client, await workingFolderPath(path)),
      createNative: (input) => workspaceCreate({ ...input, preset: "starter", registerExisting: true }),
      selectNative: workspaceSetSelected,
      runtimeActive: workspaceSetRuntimeActive,
      ensureConnection: (native, all) => ensureDesktopLocalLegalworkConnection({ route: "session", workspace: native, allWorkspaces: [...all] }),
      activate: async (id) => {
        const connection = await resolveLegalworkConnection();
        const activeClient = createLegalworkServerClient({ baseUrl: connection.normalizedBaseUrl, token: connection.resolvedToken, hostToken: connection.resolvedHostToken });
        await activeClient.activateWorkspace(id, { persist: true });
        return activeClient;
      },
      remember: writeActiveWorkspaceId,
    }, result, completion);
    return { status, registered };
  };
  // LAWOSS: tok z bočného panela po dokončenom onboardingu má „Zrušiť“ späť (prvá stránka histórie: domov).
  return <LawossWelcomePage api={client} initialStep={initialStep} initialRoot={new URLSearchParams(location.search).get("root") ?? undefined} hasCompletedOnboarding={local.prefs.hasCompletedOnboarding} onCancel={() => location.key === "default" ? navigate("/home") : navigate(-1)} pickDirectory={async () => { const result = await pickDirectory({ title: "Select LAWOSS folder", canonical: true }); return typeof result === "string" ? result : null; }} onOpenAiSettings={() => navigate("/settings/ai")} onRegister={async (result, completion) => { await register(result, completion); }} onComplete={async (result, completion) => {
    const { status, registered } = await register(result, completion);
    const okf = status.profile?.okf?.enabled === true;
    const activeId = registered?.id;
    if (registered && okf) {
      await installMissingOnboardingSkills(registered.client, registered.id, status.profile?.language ?? "sk");
      // Skilly ostatným klientom dávky; zlyhanie neprekazí dokončenie, pri otvorení klienta sa doplnia.
      for (const other of completion?.clients ?? []) if (other.workspace && other.workspace.id !== registered.id) await installMissingOnboardingSkills(registered.client, other.workspace.id, status.profile?.language ?? "sk").catch((reason: unknown) => console.warn("[lawoss] OKF skills for another practice client", reason));
    }
    local.setPrefs((previous) => ({ ...previous, documentAuthor: authorAfterOnboarding(previous.documentAuthor, status.profile?.lawyerName), hasCompletedOnboarding: true }));
    navigate(activeId ? homeRoute(activeId) : "/home", { replace: true });
  }} />;
}
