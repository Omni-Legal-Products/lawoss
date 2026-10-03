/** @jsxImportSource react */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { t } from "../../i18n";
import { pickDirectory, resolveWorkspaceListSelectedId, workspaceSetRuntimeActive, workspaceSetSelected } from "../../app/lib/desktop";
import { isDesktopRuntime } from "../../app/utils";
import { useLocal } from "../kernel/local-provider";
// 🟡 LAWOSS: our welcome screen instead of the upstream one (PATCHES.md).
import { LawossWelcomePage as WelcomePage } from "../../lawoss/domains/onboarding/lawoss-welcome-page";
import { CreateProjectModal, type CreateProjectInput } from "../domains/workspace/create-project-modal";
import { newProjectFields } from "../domains/workspace/project-defaults-store";
import { projectErrorMessage } from "../domains/workspace/project-errors";
import { resolveLegalworkConnection } from "./legalwork-connection";
import { analyticsSurface, captureAnalyticsEvent, discardPendingAnalytics, getStoredAnalyticsConsent } from "../../app/lib/analytics";
import { captureAppError } from "../../app/lib/app-error";
import { createLegalworkServerClient, type LegalworkServerClient } from "../../app/lib/legalwork-server";
import { writeActiveWorkspaceId } from "./session-memory";
import { homeRoute } from "./workspace-routes";
import { ensureDesktopLocalLegalworkConnection } from "./desktop-local-legalwork";
import { markTranscriptionIntroSeen } from "./transcription-intro";
import { markAllWhatsNewSeen } from "./whats-new";

/** First launch creates a named project, then continues the in-app setup. */
export function WelcomeRoute() {
  const navigate = useNavigate();
  const local = useLocal();
  const creating = useRef(false);
  const createdProjectId = useRef<string | null>(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [client, setClient] = useState<LegalworkServerClient | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // LAWOSS starts with anonymous analytics disabled. A prior decision wins.
  const [analyticsEnabled, setAnalyticsEnabled] = useState(() => getStoredAnalyticsConsent() ?? false);

  useEffect(() => {
    // React Router may commit navigation after the preferences update. Do not
    // replace the new project's destination with the returning-user redirect.
    if (local.prefs.hasCompletedOnboarding && !createdProjectId.current) {
      navigate("/home", { replace: true });
    }
  }, [local.prefs.hasCompletedOnboarding, navigate]);

  useEffect(() => {
    if (local.prefs.hasCompletedOnboarding) return;
    if (analyticsEnabled) {
      captureAnalyticsEvent("onboarding_welcome_viewed", { surface: analyticsSurface() });
    }
    // Mount-only: one view event per visit to the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGetStarted = useCallback(() => {
    setError(null);
    setClient(null);
    setProjectModalOpen(true);
    void resolveLegalworkConnection()
      .then(({ normalizedBaseUrl, resolvedToken, resolvedHostToken }) => {
        if (!normalizedBaseUrl || !(resolvedToken || resolvedHostToken)) {
          throw new Error(t("welcome.project_server_unavailable"));
        }
        setClient(createLegalworkServerClient({
          baseUrl: normalizedBaseUrl,
          token: resolvedToken || undefined,
          hostToken: resolvedHostToken || undefined,
        }));
      })
      .catch((connectionError: unknown) => {
        setError(projectErrorMessage(connectionError, true));
      });
  }, []);

  const handleCreateProject = useCallback(async (input: CreateProjectInput) => {
    if (!client || creating.current) return;
    creating.current = true;
    setSubmitting(true);
    setError(null);
    if (analyticsEnabled) {
      captureAnalyticsEvent("onboarding_started", { surface: analyticsSurface() });
    }
    try {
      const list = await client.createLocalWorkspace({ ...input, preset: "starter", projectFields: newProjectFields() });
      const createdId = resolveWorkspaceListSelectedId(list);
      const workspace = list.workspaces.find((item) => item.id === createdId);
      if (!createdId || !workspace) throw new Error("Created project missing from server response");
      writeActiveWorkspaceId(createdId);
      if (isDesktopRuntime()) {
        await workspaceSetSelected(createdId).catch(() => undefined);
        await workspaceSetRuntimeActive(createdId).catch(() => undefined);
        // The project is already saved; startup can be retried by the session route.
        await ensureDesktopLocalLegalworkConnection({ route: "session", workspace, allWorkspaces: list.workspaces }).catch(() => undefined);
      }
      if (analyticsEnabled) {
        captureAnalyticsEvent("workspace_created", { source: "onboarding", surface: analyticsSurface() });
      }
      if (!analyticsEnabled) discardPendingAnalytics();
      createdProjectId.current = createdId;
      local.setPrefs((prev) => ({
        ...prev,
        analyticsEnabled,
        hasCompletedOnboarding: true,
        onboardingStage: isDesktopRuntime() ? "office" : "permissions",
      }));
      markAllWhatsNewSeen();
      markTranscriptionIntroSeen();
      navigate(homeRoute(createdId), { replace: true });
    } catch (createError) {
      captureAppError("workspace_create", createError);
      setError(projectErrorMessage(createError, true));
    } finally {
      creating.current = false;
      setSubmitting(false);
    }
  }, [analyticsEnabled, client, local, navigate]);

  return (
    <>
      <WelcomePage
        onGetStarted={handleGetStarted}
        busy={submitting}
        error={!projectModalOpen ? error : null}
        analyticsEnabled={analyticsEnabled}
        onAnalyticsChange={setAnalyticsEnabled}
      />
      <CreateProjectModal
        client={client}
        open={projectModalOpen}
        onClose={() => {
          if (submitting) return;
          setProjectModalOpen(false);
          setError(null);
        }}
        onConfirm={handleCreateProject}
        onPickFolder={async () => {
          const picked = await pickDirectory({ title: t("projects.location") });
          return typeof picked === "string" ? picked : null;
        }}
        submitting={submitting}
        error={error}
      />
    </>
  );
}
