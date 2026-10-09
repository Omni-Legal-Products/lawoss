import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, win32 } from "node:path";
import type { Language } from "../src/i18n";
import type { OnboardingApi, OnboardingPlanRequest } from "../src/lawoss/domains/onboarding/api";
import { cloneTargetOf, existingClientTitle, onboardingErrorMessage, parentFolderOf, trialCloneName } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import { canonicalPathOf, canonicalPathRejection, unquotedTypedPath, withCanonicalPaths } from "../src/lawoss/domains/onboarding/typed-paths";
import { canonicalTypedDirectory } from "../../desktop/electron/lawoss-picked-path.mjs";

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

describe("an existing client folder pasted in quotes (Explorer „Copy as path“)", () => {
  const date = "2026-10-05";

  test("the clone parent, client title and copy name are derived without the quotes", () => {
    expect(parentFolderOf('"Z:\\Novák"')).toBe("Z:\\");
    expect(parentFolderOf('"C:\\Klienti\\Novák s. r. o."')).toBe("C:\\Klienti");
    expect(parentFolderOf(' "\\\\nas\\Klienti\\ACME"\r\n')).toBe("\\\\nas\\Klienti\\");
    expect(existingClientTitle('"C:\\Klienti\\Novák s. r. o."')).toBe("Novák s. r. o.");
    expect(existingClientTitle('"C:\\Klienti\\ACME\\"')).toBe("ACME");
    expect(existingClientTitle('""')).toBe("Client");
    expect(trialCloneName('"Z:\\Novák a spol"', date)).toBe("Novák a spol (trial 2026-10-05)");
    expect(cloneTargetOf(parentFolderOf('"Z:\\Novák a spol"'), '"Z:\\Novák a spol"', date)).toBe("Z:/Novák a spol (trial 2026-10-05)");
    expect(cloneTargetOf('"D:\\Kopie"', "C:\\Klienti\\ACME", date)).toBe("D:\\Kopie/ACME (trial 2026-10-05)");
    // Rovnaký názov ako vytvorí server (safeSegment): bez koncovej bodky a NBSP.
    expect(trialCloneName("C:\\Klienti\\ACME s.r.o.", date)).toBe("ACME s.r.o (trial 2026-10-05)");
    expect(trialCloneName("C:\\Klienti\\Novák\u00A0", date)).toBe("Novák (trial 2026-10-05)");
    // Rovnaké pravidlo ako `typedDirectoryInput` v desktope: okraje a jedna úvodzovka na každej strane.
    expect(unquotedTypedPath('  " C:\\Klienti "\n')).toBe("C:\\Klienti");
    expect(unquotedTypedPath('"C:\\Klienti')).toBe("C:\\Klienti");
    expect(unquotedTypedPath('""C:\\Klienti""')).toBe('"C:\\Klienti"');
    expect(unquotedTypedPath("C:\\Klienti\\Novák a spol")).toBe("C:\\Klienti\\Novák a spol");
    // Názov kópie a klienta odvodený rovnako ako na serveri (safeSegment orezáva cez trim(), aj NBSP).
    expect(unquotedTypedPath("C:\\Klienti\\Novák\u00A0")).toBe("C:\\Klienti\\Novák");
  });

  test("the existing-client request and the copy preview use the derived values", () => {
    const page = source("apps/app/src/lawoss/domains/onboarding/lawoss-welcome-page.tsx");
    const client = page.slice(page.indexOf("export function Client("), page.indexOf("export function Matter("));
    expect(client).toContain("const cloneParent = cloneParentChoice ?? parentFolderOf(value);");
    expect(client).toContain("title: existingClientTitle(value),");
    expect(client).toContain("{cloneTargetOf(cloneParent, value, today())}");
    // Pole s cestou ide na server, ako je; úvodzovky zoberie most v desktope (iba Windows).
    expect(client).toContain("root: value,");
  });

  test("Windows: a client directly in the root of a mapped drive gets a canonical clone parent and a clean title", async () => {
    // Disk `Z:` namapovaný priamo na zdieľanie `\\nas\Kancelaria` (path.win32 v desktope, súborový systém simulovaný).
    const real: Record<string, string> = { "Z:\\": "\\\\nas\\Kancelaria", "Z:\\Novák a spol": "\\\\nas\\Kancelaria\\Novák a spol" };
    const directories = new Set(["Z:\\Novák a spol", "\\\\nas\\Kancelaria\\", "\\\\nas\\Kancelaria\\Novák a spol"]);
    const missing = (value: string) => Object.assign(new Error(`ENOENT ${value}`), { code: "ENOENT" });
    const fs = {
      lstat: async (value: string) => {
        if (!directories.has(value)) throw missing(value);
        return { isSymbolicLink: () => false, isDirectory: () => true };
      },
      realpath: async (value: string) => {
        if (!(value in real)) throw missing(value);
        return real[value];
      },
    };
    const bridge = (value: string) => canonicalTypedDirectory(value, { platform: "win32", fs });
    const { api, sent } = recordingApi();
    const root = '"Z:\\Novák a spol"';
    const request: OnboardingPlanRequest = {
      action: "existing", root, mode: "trial_clone", title: existingClientTitle(root), clientType: "po", jurisdiction: "sk",
      date, language: "sk", confirmUnknownClient: true, cloneParent: parentFolderOf(root),
    };
    await withCanonicalPaths(api, bridge).planOnboarding(request);
    expect(sent).toEqual([{ ...request, root: "\\\\nas\\Kancelaria\\Novák a spol", cloneParent: "\\\\nas\\Kancelaria\\", title: "Novák a spol" }]);
    // Kópia (`join` v `planExistingClient`) vznikne v kanonickom koreni zdieľania, nie v `Z:\`, ktorý kontrola pri skúšobnom klone odmietne.
    expect(win32.join("\\\\nas\\Kancelaria\\", trialCloneName(root, date))).toBe("\\\\nas\\Kancelaria\\Novák a spol (trial 2026-10-05)");
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

test("suggest prevedie cestu z Prieskumníka rovnako ako classify", async () => {
  const seen: string[] = [];
  const api = {
    classifyOnboarding: async () => ({ level: "unknown" as const }),
    planOnboarding: async () => ({ id: "x", fingerprint: "y", preview: {} }),
    updateOnboardingProfile: async () => ({ version: 1 as const, lawyerName: "L", jurisdiction: "sk" as const, language: "sk" as const }),
    suggestOnboarding: async (input: { root: string }) => { seen.push(input.root); return { root: input.root, level: "client" as const, marked: false, score: 0.5, signals: [], clients: [], complete: true }; },
  };
  const wrapped = withCanonicalPaths(api, async value => value.replace(/^"|"$/g, "").replace("z:", "Z:"));
  await wrapped.suggestOnboarding?.({ root: "\"z:\\Klienti\\Novák\"" });
  expect(seen).toEqual(["Z:\\Klienti\\Novák"]);
});
