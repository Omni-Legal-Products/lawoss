import { describe, expect, test } from "bun:test";
import { ensureSkillAvailable, reloadAfterSkillWrites, type SkillEngine } from "../src/lawoss/okf/skill-availability";
import { t } from "../src/i18n";

/** Engine, ktorý nový skill uvidí až po obnovení (správanie OpenCode zistené pri teste 5. 10. 2026). */
function engine(options: { known?: boolean; busy?: boolean; visibleAfterReload?: boolean } = {}) {
  let reloaded = 0, known = options.known ?? false;
  const value: SkillEngine = {
    commandNames: async () => (known ? ["init", "review", "roztried-spis"] : ["init", "review"]),
    reload: async () => { reloaded++; if (options.visibleAfterReload ?? true) known = true; },
    busy: () => options.busy ?? false,
  };
  return { value, reloads: () => reloaded };
}
const quick = { sleep: async () => {}, attempts: 3 };

describe("skill je pred rozhovorom dostupný", () => {
  test("viditeľný skill: žiadne obnovenie", async () => {
    const e = engine({ known: true });
    expect(await ensureSkillAvailable(e.value, "roztried-spis", quick)).toBe("ready");
    expect(e.reloads()).toBe(0);
  });
  test("nový skill: engine sa obnoví a skill sa objaví", async () => {
    const e = engine();
    expect(await ensureSkillAvailable(e.value, "roztried-spis", quick)).toBe("reloaded");
    expect(e.reloads()).toBe(1);
  });
  test("bežiaca úloha sa nikdy nepreruší obnovením", async () => {
    const e = engine({ busy: true });
    expect(await ensureSkillAvailable(e.value, "roztried-spis", quick)).toBe("busy");
    expect(e.reloads()).toBe(0);
  });
  test("ak ani obnova nepomôže, rozhovor sa neotvorí", async () => {
    const e = engine({ visibleAfterReload: false });
    expect(await ensureSkillAvailable(e.value, "roztried-spis", quick)).toBe("missing");
  });
  test("po inštalácii skillov pri onboardingu a otvorení klienta sa engine obnoví len keď treba", async () => {
    const calls: string[] = [];
    const client = { reloadEngine: async (id: string) => { calls.push(id); return { ok: true }; } };
    expect(await reloadAfterSkillWrites(client, "ws", [], () => false)).toBe(false);
    expect(await reloadAfterSkillWrites(client, "ws", ["roztried-spis"], () => true)).toBe(false);
    expect(await reloadAfterSkillWrites({}, "ws", ["roztried-spis"], () => false)).toBe(false);
    expect(await reloadAfterSkillWrites(client, "ws", ["roztried-spis"], () => false)).toBe(true);
    expect(calls).toEqual(["ws"]);
  });
  test("úvodná správa neukazuje technickú cestu, len meno klona", () => {
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      const prompt = t("lawoss.triage.model_prompt", locale, { client: "Horizont Stavby (trial 2026-10-05)" });
      expect(prompt.startsWith("/roztried-spis ")).toBe(true);
      expect(prompt).toContain("Horizont Stavby (trial 2026-10-05)");
      expect(prompt).not.toContain("/private");
    }
  });
});
