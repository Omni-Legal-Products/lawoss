import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Matter, preferOpenClient, welcomeText, type WelcomeApi } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import type { OnboardingProfile } from "../src/lawoss/domains/onboarding/api";

const OKF_ON = { enabled: true as const, acknowledgedAt: "2026-10-05T08:00:00.000Z", noticeVersion: "2026-10-04-alfa-1" };
const SAVED = "/Users/test/Klienti/Posledný klient s. r. o.";
const OPEN = "/Users/test/Klienti/Otvorený klient s. r. o.";
const profile = (extra: Partial<OnboardingProfile> = {}): OnboardingProfile => ({ version: 1, lawyerName: "Test", jurisdiction: "sk", language: "sk", okf: OKF_ON, clientRoot: SAVED, ...extra });
const workspaces = [
  { id: "saved", name: "Posledný klient s. r. o.", path: SAVED, preset: "starter", workspaceType: "local" as const },
  { id: "open", name: "otvoreny", path: OPEN, preset: "starter", workspaceType: "local" as const },
  { id: "matter", name: "vec", path: `${OPEN}/Spisy/2026-10 Žaloba`, preset: "starter", workspaceType: "local" as const },
  { id: "plain", name: "Dokumenty", path: "/Users/test/Dokumenty", preset: "starter", workspaceType: "local" as const },
];
const files: Record<string, string[]> = { saved: ["client.md"], open: ["client.md"], matter: ["matter.md"], plain: ["poznamky.txt"] };

function api(options: { failUpdate?: boolean } = {}) {
  const updates: Partial<OnboardingProfile>[] = [];
  const value: WelcomeApi = {
    onboardingStatus: async () => ({ profile: profile(), capabilities: { map: true, trialClone: true } }),
    updateOnboardingProfile: async (patch) => {
      updates.push(patch);
      if (options.failUpdate) throw new Error("Selected clientRoot does not identify a complete client.");
      return profile({ clientRoot: patch.clientRoot });
    },
    classifyOnboarding: async () => ({ level: "unknown" }),
    planOnboarding: async () => ({ id: "plan", fingerprint: "f", preview: {} }),
    applyOnboarding: async () => ({ result: "applied" }),
    listWorkspaces: async () => ({ items: workspaces, activeId: "saved" }),
    listWorkspaceDirectory: async (id, path) => ({ path, truncated: false, entries: (files[id] ?? []).map((name) => ({ name, path: name, kind: "file" as const })) }),
    readWorkspaceFile: async (id, path) => ({ path, content: id === "open" ? "---\ntype: client\ntitle: Otvorený klient s. r. o.\n---\n" : "---\ntype: client\n---\n" }) as Awaited<ReturnType<NonNullable<WelcomeApi["readWorkspaceFile"]>>>,
  };
  return { api: value, updates };
}

describe("new matter under the right client", () => {
  test("prefers the client of the open workspace over the last saved one", async () => {
    const f = api();
    const next = await preferOpenClient(f.api, profile(), "open");
    expect(f.updates).toEqual([{ clientRoot: OPEN, step: "matter" }]);
    expect(next?.clientRoot).toBe(OPEN);
  });

  test("a matter opened as its own workspace uses its registered client", async () => {
    const f = api();
    expect((await preferOpenClient(f.api, profile(), "matter"))?.clientRoot).toBe(OPEN);
  });

  test("keeps the last saved client when the open workspace is not an OKF client", async () => {
    for (const active of ["plain", "saved", "missing", null]) {
      const f = api();
      expect(await preferOpenClient(f.api, profile(), active)).toBeNull();
      // `null` falls back to the server's active workspace, which is the saved client here.
      expect(f.updates).toEqual([]);
    }
  });

  test("keeps the last saved client when the server rejects the open folder", async () => {
    const f = api({ failUpdate: true });
    expect(await preferOpenClient(f.api, profile(), "open")).toBeNull();
  });

  test("does nothing without OKF or without access to workspaces", async () => {
    const f = api();
    expect(await preferOpenClient(f.api, profile({ okf: { enabled: false } }), "open")).toBeNull();
    const { listWorkspaces: _ignored, ...withoutList } = f.api;
    expect(await preferOpenClient(withoutList, profile(), "open")).toBeNull();
    expect(f.updates).toEqual([]);
  });

  test("the form names the client the matter is created under", () => {
    const html = renderToStaticMarkup(
      <Matter title="Nová vec" clientTitle="Otvorený klient s. r. o." base={profile({ clientRoot: OPEN })} locale="sk" tr={welcomeText("sk")} busy={false}
        onPlan={async () => {}} onClientChange={async () => {}} onSubjectChange={async () => {}} />,
    );
    expect(html).toContain("Nová vec");
    expect(html).toContain("Vec vznikne pod klientom");
    expect(html).toContain("Otvorený klient s. r. o.</p>");
    expect(html).toContain(OPEN);
    expect(html).toContain("Iný klient (priečinok)");
    expect(html).toContain("Použiť tohto klienta");
  });

  test("without a client the form asks for one", () => {
    const html = renderToStaticMarkup(
      <Matter title="Nová vec" clientTitle="" base={profile({ clientRoot: undefined })} locale="cs" tr={welcomeText("cs")} busy={false}
        onPlan={async () => {}} onClientChange={async () => {}} onSubjectChange={async () => {}} />,
    );
    expect(html).toContain("Vyberte složku klienta, pod kterým věc vznikne.");
  });
});
