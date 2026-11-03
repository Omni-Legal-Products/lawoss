// LAWOSS (test inštalácie 3. 11. 2026): nový formulár pamäte prípadu ukazoval „Invalid version 1 memory profile.“
import { afterEach, describe, expect, test } from "bun:test";
import { setLocale, t, type Language } from "../src/i18n";
import { emptyMemoryProfile, memoryProfileProblem, previewMemoryProfile, type WorkspaceMemoryProfile } from "../src/lawoss/okf/workspace-memory-profile";

afterEach(() => setLocale("en"));

const problem = (profile: WorkspaceMemoryProfile, locale: Language = "sk") => {
  try { previewMemoryProfile(profile); return null; } catch (failure) { return memoryProfileProblem(profile, failure, locale); }
};
const valid = (): WorkspaceMemoryProfile => {
  const profile = emptyMemoryProfile();
  return { ...profile, matterId: "C001-2026", sources: profile.sources.map((source) => ({ ...source, anchors: ["C001"] })) };
};

describe("chyby profilu pamäte v jazyku appky", () => {
  test("nový prázdny formulár žiada identitu prípadu, nie anglickú chybu parsera", () => {
    expect(problem(emptyMemoryProfile())).toBe(t("lawoss.integrations.memory.problem.identity", "sk"));
  });

  test("konkrétne chyby návrhu", () => {
    const base = valid();
    expect(problem(base)).toBeNull();
    expect(problem({ ...base, sources: base.sources.map((source) => ({ ...source, anchors: [] })) })).toBe(t("lawoss.integrations.memory.problem.anchors_required", "sk"));
    expect(problem({ ...base, sources: [...base.sources, { id: "dokaz", root: "matter", path: "a.pdf", role: "evidence", required: false, writable: true }] })).toBe(t("lawoss.integrations.memory.problem.writable", "sk"));
    expect(problem({ ...base, roots: [...base.roots, { id: "matter", path: "druhy" }] })).toBe(t("lawoss.integrations.memory.problem.root", "sk"));
    expect(problem({ ...base, sources: [{ ...base.sources[0], root: "neznamy" }] })).toBe(t("lawoss.integrations.memory.problem.source", "sk"));
    expect(problem({ ...base, sources: [] })).toBe(t("lawoss.integrations.memory.problem.count", "sk"));
    expect(problem({ ...base, sources: [{ ...base.sources[0], required: false }] })).toBe(t("lawoss.integrations.memory.problem.case_memory", "sk"));
  });

  test("žiadny jazyk nedostane anglický text parsera ani neznámy kľúč", () => {
    for (const locale of ["sk", "cs", "de"] as Language[]) {
      const text = problem(emptyMemoryProfile(), locale) ?? "";
      expect(text).not.toMatch(/Invalid|lawoss\./);
      expect(memoryProfileProblem(null, new SyntaxError("Unexpected token"), locale)).toBe(t("lawoss.integrations.memory.problem.other", locale));
    }
  });
});
