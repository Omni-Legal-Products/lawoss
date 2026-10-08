import { describe, expect, test } from "bun:test";
import type { OnboardingApi, OnboardingApplyResult, OnboardingPlanRequest, OnboardingSuggestion } from "../src/lawoss/domains/onboarding/api";
import type { TriageApiPath } from "../src/lawoss/domains/roztriedenie/api";
import {
  addOkfFiles, childPath, connectPractice, convertRequest, documentLanguage, firstWorkspaceResult,
  folderName, freshOfficeRequest, isEmptyFolderSuggestion, matterClientPath, parentPath, practiceRequest, reorganizeTarget, retryFailed, startReorganize, type BatchItem,
} from "../src/lawoss/domains/onboarding/found-flow";

const identity = { lawyerName: "Syntetický advokát", jurisdiction: "sk" as const, language: "sk" as const };
const today = new Date("2026-10-08T10:00:00Z");
const suggestion = (patch: Partial<OnboardingSuggestion> = {}): OnboardingSuggestion => ({ root: "/p", level: "practice", marked: false, score: 1, signals: [], clientPattern: "*", clients: [], complete: true, ...patch });

/** Falošné API: zaznamená požiadavky; klient s názvom „Zamknutý“ zlyhá pri pláne. */
function fakeApi() {
  const plans: OnboardingPlanRequest[] = [], applied: string[] = [], profiles: unknown[] = [];
  const api: Pick<OnboardingApi, "planOnboarding" | "applyOnboarding" | "updateOnboardingProfile"> = {
    planOnboarding: async (request) => {
      plans.push(request);
      if ("root" in request && request.root.endsWith("Zamknutý")) throw new Error("locked_file");
      return { id: `id-${plans.length}`, fingerprint: "f".repeat(64), preview: { operations: ["AGENTS.md"] } };
    },
    applyOnboarding: async (input): Promise<OnboardingApplyResult> => {
      applied.push(input.id);
      const request = plans[Number(input.id.slice(3)) - 1];
      const root = request && "root" in request ? request.root : "";
      return { result: "applied", root, clientRoot: root, workspace: { id: `ws-${applied.length}`, path: root } };
    },
    updateOnboardingProfile: async (patch) => { profiles.push(patch); return { version: 1, lawyerName: "L", jurisdiction: "sk", language: "sk" }; },
  };
  return { api, plans, applied, profiles };
}

describe("cesty a predvolené hodnoty", () => {
  test("meno, rodič a podpriečinok na macOS aj Windows", () => {
    expect(folderName("/Users/a/Klienti/Novák s.r.o/")).toBe("Novák s.r.o");
    expect(folderName("C:\\Klienti\\Alfa s. r. o.")).toBe("Alfa s. r. o.");
    expect(parentPath("/Users/a/Klienti/Novák/2024-03 Zmluva")).toBe("/Users/a/Klienti/Novák");
    expect(parentPath("C:\\Klienti\\Novák\\2024-03 Zmluva")).toBe("C:\\Klienti\\Novák");
    expect(childPath("/p", "A/Alfa s.r.o")).toBe("/p/A/Alfa s.r.o");
    expect(childPath("C:\\p", "A/Alfa s.r.o")).toBe("C:\\p\\A\\Alfa s.r.o");
  });
  test("jazyk dokumentov a typ klienta z právnej formy", () => {
    expect(documentLanguage("cs")).toBe("cs");
    expect(documentLanguage("de")).toBe("en");
    expect(convertRequest("/k/Alfa s. r. o.", identity, today)).toEqual({ action: "existing", root: "/k/Alfa s. r. o.", mode: "convert", title: "Alfa s. r. o.", clientType: "po", jurisdiction: "sk", date: "2026-10-08", language: "sk", confirmUnknownClient: true });
    expect(convertRequest("/k/Novák Ján", identity, today).clientType).toBe("fo");
  });
  test("prax nesie vzor klientov z návrhu", () => {
    expect(practiceRequest("/p/Kancelária", identity, suggestion({ clientPattern: "*/*" }), "client")).toEqual({ action: "practice", root: "/p/Kancelária", title: "Kancelária", jurisdiction: "sk", language: "sk", lawyerName: "Syntetický advokát", clientPattern: "*/*", scope: "client" });
    expect(practiceRequest("/p", identity, suggestion({ clientPattern: undefined }), "practice").clientPattern).toBe("*");
  });
});

describe("hromadné pridanie OKF súborov", () => {
  test("zlyhanie jedného klienta nezastaví ostatných; súhrn a opakovanie len neúspešných", async () => {
    const { api, applied } = fakeApi();
    const progress: BatchItem[][] = [];
    const items = await addOkfFiles(api, [{ root: "/p/Alfa", name: "Alfa" }, { root: "/p/Zamknutý", name: "Zamknutý" }, { root: "/p/Gama", name: "Gama" }], identity, today, next => progress.push(next));
    expect(items.map(item => item.status)).toEqual(["done", "failed", "done"]);
    expect(items[1]?.error).toBe("locked_file");
    expect(applied).toHaveLength(2);
    expect(progress.at(-1)).toEqual(items);
    expect(firstWorkspaceResult(items)?.workspace?.path).toBe("/p/Alfa");
    const again = await retryFailed(api, items, identity, today, () => undefined);
    expect(again.map(item => item.status)).toEqual(["done", "failed", "done"]);
    expect(applied).toHaveLength(2);
  });
});

describe("prax a usporiadanie", () => {
  test("pripojenie praxe zapíše kanceláriu a uloží ju do profilu", async () => {
    const { api, plans, profiles } = fakeApi();
    await connectPractice(api, "/p", identity, suggestion(), "client");
    expect(plans[0]).toMatchObject({ action: "practice", root: "/p", scope: "client" });
    expect(profiles).toEqual([{ officeRoot: "/p" }]);
  });
  test("usporiadanie najprv udelí súhlas, potom pripraví náhľad", async () => {
    const calls: { path: TriageApiPath; body: unknown }[] = [];
    const client = { lawossTriage: async <T,>(path: TriageApiPath, body: unknown): Promise<T> => { calls.push({ path, body }); return (path === "grant" ? { granted: true, root: "/k" } : { id: "t", fingerprint: "f", moves: [] }) as T; } };
    await startReorganize(client, "/k");
    expect(calls.map(call => call.path)).toEqual(["grant", "plan"]);
    expect(calls[0]?.body).toEqual({ root: "/k", confirm: true });
  });
  test("označená prax sa nepláne znova, len sa uloží do profilu", async () => {
    const { api, plans, profiles } = fakeApi();
    const result = await connectPractice(api, "/p", identity, suggestion({ marked: true }), "client");
    expect(plans).toHaveLength(0);
    expect(profiles).toEqual([{ officeRoot: "/p" }]);
    expect(result).toEqual({ result: "applied", root: "/p" });
  });
  test("cieľ usporiadania je zaregistrovaný pracovný priečinok, potom koreň klienta, potom pôvodná cesta", () => {
    const base: BatchItem = { root: "/p/A", name: "A", status: "done" };
    expect(reorganizeTarget({ ...base, result: { result: "applied", root: "/p/A/Office", clientRoot: "/p/A", workspace: { id: "w", path: "/p/A" } } })).toBe("/p/A");
    expect(reorganizeTarget({ ...base, result: { result: "applied", root: "/p/A/Office", clientRoot: "/p/A/Klient" } })).toBe("/p/A/Klient");
    expect(reorganizeTarget(base)).toBe("/p/A");
  });
});

describe("opravy po celkovej kontrole", () => {
  test("vec v Spisy/ patrí klientovi nad Spisy, inak priamemu rodičovi (macOS aj Windows)", () => {
    expect(matterClientPath("/p/Novák/Spisy/2024-03 Zmluva")).toBe("/p/Novák");
    expect(matterClientPath("/p/Novák/2024-03 Zmluva")).toBe("/p/Novák");
    expect(matterClientPath("C:\\Klienti\\Novák\\Spisy\\2024-03 Zmluva\\")).toBe("C:\\Klienti\\Novák");
    expect(matterClientPath("C:\\Klienti\\Novák\\2024-03 Zmluva")).toBe("C:\\Klienti\\Novák");
  });
  test("Začať nanovo: jazyk dokumentov kancelárie z jazyka rozhrania (nemčina píše anglicky)", () => {
    expect(freshOfficeRequest("/p/Nový", { ...identity, language: "de" })).toEqual({ action: "office", parent: "/p/Nový", title: "LAWOSS", jurisdiction: "sk", language: "en", lawyerName: "Syntetický advokát" });
    expect(freshOfficeRequest("/p/Nový", { ...identity, language: "cs" }).language).toBe("cs");
  });
  test("Začať nanovo len do prázdneho priečinka", () => {
    expect(isEmptyFolderSuggestion(suggestion({ level: "unknown", signals: ["empty"] }))).toBe(true);
    expect(isEmptyFolderSuggestion(suggestion({ level: "unknown", signals: ["documents_only"] }))).toBe(false);
    expect(isEmptyFolderSuggestion(suggestion({ level: "client", signals: ["empty"] }))).toBe(false);
  });
  test("dátum karty je miestny deň aj tesne pred a po polnoci", () => {
    // bun test beží v UTC; posun pásma ukáže rozdiel medzi miestnym dňom a dňom v UTC.
    const saved = process.env.TZ;
    try {
      for (const zone of ["Europe/Bratislava", "America/New_York"]) {
        process.env.TZ = zone;
        expect(convertRequest("/p/A", identity, new Date(2026, 9, 8, 23, 30)).date).toBe("2026-10-08");
        expect(convertRequest("/p/A", identity, new Date(2026, 9, 8, 0, 30)).date).toBe("2026-10-08");
      }
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });
});
