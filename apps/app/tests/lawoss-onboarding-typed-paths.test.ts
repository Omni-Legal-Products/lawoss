import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Language } from "../src/i18n";
import type { OnboardingApi, OnboardingPlanRequest } from "../src/lawoss/domains/onboarding/api";
import { onboardingErrorMessage } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import { canonicalPathOf, canonicalPathRejection, withCanonicalPaths } from "../src/lawoss/domains/onboarding/typed-paths";

const repo = join(import.meta.dir, "../../..");
const source = (path: string) => readFileSync(join(repo, path), "utf8");

/** Onboarding API, ktoré si zapamätá, čo dostalo; ďalšie metódy klienta musia obalom prejsť. */
function recordingApi() {
  const sent: unknown[] = [];
  const api = {
    onboardingStatus: async () => ({ profile: null, capabilities: { map: true, trialClone: true } }),
    updateOnboardingProfile: async (profile) => { sent.push(profile); return { version: 1, lawyerName: "", jurisdiction: "sk", language: "sk" }; },
    classifyOnboarding: async (input) => { sent.push(input); return { level: "unknown" }; },
    planOnboarding: async (request) => { sent.push(request); return { id: "plan", fingerprint: "f", preview: {} }; },
    applyOnboarding: async () => ({ result: "applied" }),
    listWorkspaces: async () => ({ items: [] }),
  } satisfies OnboardingApi & { listWorkspaces: () => Promise<{ items: never[] }> };
  return { api, sent };
}
const seen: string[] = [];
const canonical = async (value: string) => { seen.push(value); return `K:${value}`; };

describe("typed and pasted onboarding paths", () => {
  test("only folder path fields are canonicalized, names and memory fields stay as typed", async () => {
    const { api, sent } = recordingApi();
    const wrapped = withCanonicalPaths(api, canonical);
    seen.length = 0;
    await wrapped.classifyOnboarding({ root: "z:\\Kancelaria" });
    const requests: OnboardingPlanRequest[] = [
      { action: "office", parent: "\"Z:\\Kancelaria\"", title: "C:\\nie-cesta", name: "Office", jurisdiction: "sk", language: "sk", lawyerName: "JUDr. Test" },
      { action: "client", parent: "Z:\\Klienti", name: "Z:\\Klient", title: "Z:\\Klient", clientType: "po", jurisdiction: "sk", date: "2026-10-05", language: "sk" },
      { action: "subject", clientRoot: "Z:\\Klienti\\Novák", name: "Z:\\Subjekt", title: "Subjekt" },
      { action: "matter", clientRoot: "Z:\\Klienti\\Novák", parent: "Z:\\Klienti\\Novák\\Veci", title: "Spor", date: "2026-10-05", kind: "contentious", area: "Z:\\oblast", jurisdiction: "sk", subject: "Z:\\Subjekt", language: "sk" },
      { action: "existing", root: "Z:\\Novák", mode: "map", title: "Novák", clientType: "po", jurisdiction: "sk", date: "2026-10-05", language: "sk", memoryPath: "Z:\\Pamat", identityAnchor: "Z:\\Kotva", cloneParent: "Z:\\" },
    ];
    for (const request of requests) await wrapped.planOnboarding(request);
    await wrapped.updateOnboardingProfile({ officeRoot: "z:\\Office", clientRoot: "Z:\\KLIENTI\\Novák", subjectRoot: null, matterRoot: "Z:\\Vec", lawyerName: "Z:\\Meno", step: "matter" });

    expect(sent).toEqual([
      { root: "K:z:\\Kancelaria" },
      { ...requests[0], parent: "K:\"Z:\\Kancelaria\"" },
      { ...requests[1], parent: "K:Z:\\Klienti" },
      { ...requests[2], clientRoot: "K:Z:\\Klienti\\Novák" },
      { ...requests[3], clientRoot: "K:Z:\\Klienti\\Novák", parent: "K:Z:\\Klienti\\Novák\\Veci" },
      { ...requests[4], root: "K:Z:\\Novák", cloneParent: "K:Z:\\" },
      { officeRoot: "K:z:\\Office", clientRoot: "K:Z:\\KLIENTI\\Novák", subjectRoot: null, matterRoot: "K:Z:\\Vec", lawyerName: "Z:\\Meno", step: "matter" },
    ]);
    // Názov, titul, subjekt, oblasť, pamäť ani kotva identity sa do mosta vôbec nedostanú.
    for (const untouched of ["C:\\nie-cesta", "Z:\\Klient", "Z:\\Subjekt", "Z:\\oblast", "Z:\\Pamat", "Z:\\Kotva", "Z:\\Meno"]) expect(seen).not.toContain(untouched);
    expect(requests[0].action === "office" && requests[0].parent).toBe("\"Z:\\Kancelaria\"");
  });

  test("empty fields and other client methods pass through unchanged", async () => {
    const { api, sent } = recordingApi();
    const wrapped = withCanonicalPaths(api, canonical);
    seen.length = 0;
    await wrapped.updateOnboardingProfile({ officeRoot: "", clientRoot: "  ", step: "client" });
    await wrapped.updateOnboardingProfile({ subjectRoot: null });
    expect(sent).toEqual([{ officeRoot: "", clientRoot: "  ", step: "client" }, { subjectRoot: null }]);
    expect(seen).toEqual([]);
    expect(wrapped.onboardingStatus).toBe(api.onboardingStatus);
    expect(wrapped.applyOnboarding).toBe(api.applyOnboarding);
    expect(wrapped.listWorkspaces).toBe(api.listWorkspaces);
  });

  test("a failing or empty bridge result sends the original path, the server rejects it as before", async () => {
    const { api, sent } = recordingApi();
    const flaky = async (value: string) => {
      if (value.includes("Chyba")) throw new Error("Electron desktop bridge method is not implemented yet: canonicalDirectoryPath");
      return value.includes("Prazdne") ? "" : `K:${value}`;
    };
    const wrapped = withCanonicalPaths(api, flaky);
    await wrapped.planOnboarding({ action: "matter", clientRoot: "Z:\\Chyba", parent: "Z:\\Prazdne", title: "Spor", date: "2026-10-05", kind: "contentious", area: "", jurisdiction: "sk", language: "sk" });
    await wrapped.updateOnboardingProfile({ officeRoot: "Z:\\Office", clientRoot: "Z:\\Chyba" });
    expect(sent[0]).toMatchObject({ clientRoot: "Z:\\Chyba", parent: "Z:\\Prazdne" });
    expect(sent[1]).toEqual({ officeRoot: "K:Z:\\Office", clientRoot: "Z:\\Chyba" });
    expect(await canonicalPathOf("Z:\\Chyba", flaky)).toBe("Z:\\Chyba");
    expect(await canonicalPathOf("Z:\\Ok", flaky)).toBe("K:Z:\\Ok");
  });

  test("the welcome route canonicalizes typed paths only in the desktop runtime, including the working folder", () => {
    const route = source("apps/app/src/react-app/shell/welcome-route.tsx");
    expect(route).toContain("isDesktopRuntime() ? withCanonicalPaths(client, canonicalDirectoryPath) : client");
    expect(route).toContain("setClient(typedPaths(createLegalworkServerClient(");
    expect(route).toContain("isDesktopRuntime() ? canonicalPathOf(value, canonicalDirectoryPath) : Promise.resolve(value)");
    expect(route).toContain("registerWorkingFolder(client, await workingFolderPath(completion.workingFolder))");
    // Výber v dialógu ostáva cez pickDirectory s voľbou canonical.
    expect(route).toContain('pickDirectory({ title: "Select LAWOSS folder", canonical: true })');
    const bridge = source("apps/app/src/app/lib/desktop.ts");
    expect(bridge.match(/^ {2}canonicalDirectoryPath,$/gm)?.length).toBe(2);
    expect(source("packages/types/src/desktop-ipc.ts")).toContain("canonicalDirectoryPath: { args: [value: string]; result: string };");
  });
});

describe("canonical path rejections in the UI language", () => {
  const rejections = [
    "Choose an existing canonical directory.",
    "registerExisting requires an existing canonical directory",
    "Parent must be a canonical existing directory.",
    "Plan root must be a canonical directory.",
    "Plan root must be canonical.",
    "Trial cloning requires existing canonical directories.",
    "ENOENT: no such file or directory, realpath 'C:\\Klienti\\Neexistuje'",
    "ENOTDIR: not a directory, realpath 'C:\\spis.pdf\\Klienti'",
  ];
  const expected: Record<Language, string> = {
    sk: "Priečinok neexistuje alebo cesta k nemu vedie cez odkaz (junction). Vyberte ho tlačidlom „Vybrať priečinok“.",
    cs: "Složka neexistuje nebo cesta k ní vede přes odkaz (junction). Vyberte ji tlačítkem „Vybrat složku“.",
    en: "The folder does not exist or its path leads through a link (junction). Choose it with the \"Choose folder\" button.",
    de: "Der Ordner existiert nicht oder sein Pfad führt über eine Verknüpfung (Junction). Wählen Sie ihn mit der Schaltfläche „Ordner wählen“.",
  };

  test("server and OKF rejections of a chosen folder name the folder button", () => {
    for (const message of rejections) {
      for (const locale of ["sk", "cs", "en", "de"] as const) {
        expect(onboardingErrorMessage(new Error(message), locale)).toBe(expected[locale]);
      }
    }
  });

  test("the folder button label in the message matches the path field", () => {
    const page = source("apps/app/src/lawoss/domains/onboarding/lawoss-welcome-page.tsx");
    const picker = page.slice(page.indexOf("function PathInput("), page.indexOf("}[locale];", page.indexOf("function PathInput(")));
    for (const label of ["Choose folder", "Vybrať priečinok", "Vybrat složku", "Ordner wählen"]) expect(picker).toContain(`"${label}"`);
  });

  test("application folders, the memory path and other errors stay as sent", () => {
    for (const message of [
      "Journal directory must be a canonical directory.",
      "External profile directory must use a canonical directory path.",
      "Matter must be within the selected client.",
      "ENOENT: no such file or directory, open 'C:\\Klienti\\profile.json'",
    ]) {
      expect(canonicalPathRejection(new Error(message), "sk")).toBeUndefined();
      expect(onboardingErrorMessage(new Error(message), "sk")).toBe(message);
    }
    expect(canonicalPathRejection("Choose an existing canonical directory.", "sk")).toBeUndefined();
  });

  test("the mapped texts still exist where the server and OKF throw them", () => {
    expect(source("apps/server/src/lawoss/onboarding.ts")).toContain('"Choose an existing canonical directory."');
    expect(source("apps/server/src/routes/workspaces.ts")).toContain('"registerExisting requires an existing canonical directory"');
    expect(source("lawoss/okf/src/onboarding/entities.ts")).toContain('"Parent must be a canonical existing directory."');
    expect(source("lawoss/okf/src/onboarding/trial-clone.ts")).toContain('"Trial cloning requires existing canonical directories."');
    const transaction = source("lawoss/okf/src/onboarding/transaction.ts");
    expect(transaction).toContain("`${label} must be a canonical directory.`");
    expect(transaction).toContain('canonicalDirectory(plan.root, "Plan root")');
    expect(transaction).toContain('"Plan root must be canonical."');
  });
});
