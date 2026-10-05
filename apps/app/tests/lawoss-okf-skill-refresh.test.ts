import { describe, expect, test } from "bun:test";
import { BUNDLED_OKF_SKILL_HASHES } from "../src/lawoss/okf/bundled-skill-hashes";
import {
  NOVY_SPIS_SKILL_NAME,
  OKF_CLI_RESOURCE_NAME,
  OKF_MEMORY_CLI_RESOURCE_NAME,
  OKF_PAMAT_SKILL_NAME,
  novySpisSkillBody,
  okfCliSource,
  okfMemoryCliSource,
  pamatSkillBody,
  usporiadajSpisSkillBody,
  roztriedSpisSkillBody,
  vystupSkillBody,
} from "../src/lawoss/okf/skill-bundle";
import { okfSkillBodyHash, refreshOkfSkills, type OkfSkillClient } from "../src/lawoss/okf/skill-refresh";

const stored = (content: string) => `---\nname: x\ndescription: y\n---\n${content}`;
type Installed = { content: string; scope?: "project" | "global"; resources: Map<string, string> };

function fixture(installed: Record<string, Installed>) {
  const writes: string[] = [];
  const client: OkfSkillClient = {
    listSkills: async () => ({ items: Object.entries(installed).map(([name, skill]) => ({ name, path: `/${name}`, description: "", scope: skill.scope ?? "project" })), skipped: [] }),
    getSkill: async (_id, name) => {
      const skill = installed[name];
      if (!skill) throw new Error("missing");
      return { item: { name, path: `/${name}`, description: "", scope: "project" }, content: skill.content };
    },
    upsertSkill: async (_id, payload) => {
      writes.push(`skill:${payload.name}`);
      installed[payload.name] = { content: stored(payload.content), resources: installed[payload.name]?.resources ?? new Map() };
      return { name: payload.name, path: "/", description: "", scope: "project" };
    },
    listSkillResources: async (_id, skill) => ({ items: [...(installed[skill]?.resources.keys() ?? [])].map((name) => ({ name, path: `/${name}`, size: 1, updatedAt: 0 })) }),
    getSkillResource: async (_id, skill, name) => ({ item: { name, path: `/${name}`, size: 1, updatedAt: 0 }, content: installed[skill]?.resources.get(name) ?? "" }),
    upsertSkillResource: async (_id, skill, payload) => {
      writes.push(`resource:${skill}/${payload.name}`);
      installed[skill]?.resources.set(payload.name, payload.content ?? "");
      return { ok: true, name: payload.name, path: "/", action: "updated" };
    },
  };
  return { client, writes, installed };
}
const novy = { name: NOVY_SPIS_SKILL_NAME, body: novySpisSkillBody("sk"), resource: OKF_CLI_RESOURCE_NAME, source: okfCliSource() };
const pamat = { name: OKF_PAMAT_SKILL_NAME, body: pamatSkillBody(), resource: OKF_MEMORY_CLI_RESOURCE_NAME, source: okfMemoryCliSource() };
const current = (skill: typeof novy, resource = skill.source): Installed => ({ content: stored(skill.body.content), resources: new Map([[skill.resource, resource]]) });

describe("OKF bundle refresh in an existing workspace", () => {
  test("every currently bundled SKILL.md body is a known bundled version", async () => {
    for (const body of [novySpisSkillBody("sk"), novySpisSkillBody("cs"), pamatSkillBody(), usporiadajSpisSkillBody(), roztriedSpisSkillBody("sk"), roztriedSpisSkillBody("cs"), vystupSkillBody()]) {
      const hash = await okfSkillBodyHash(stored(body.content));
      expect({ hash, known: BUNDLED_OKF_SKILL_HASHES.has(hash) }).toEqual({ hash, known: true });
    }
  });

  test("hash ignores frontmatter and line endings of the stored file", async () => {
    expect(await okfSkillBodyHash("---\r\nname: a\r\n---\r\n# Body\r\n")).toBe(await okfSkillBodyHash("# Body\n"));
  });

  test("installs a missing skill with its resource", async () => {
    const f = fixture({});
    expect(await refreshOkfSkills(f.client, "w", [novy])).toEqual({ modified: [], written: ["novy-spis"] });
    expect(f.writes).toEqual(["skill:novy-spis", "resource:novy-spis/okf.js"]);
  });

  test("leaves an up-to-date skill untouched", async () => {
    const f = fixture({ "novy-spis": current(novy), "okf-pamat": current(pamat) });
    expect(await refreshOkfSkills(f.client, "w", [novy, pamat])).toEqual({ modified: [], written: [] });
    expect(f.writes).toEqual([]);
  });

  test("refreshes okf.js and okf-memory.js when they differ from the bundle", async () => {
    const f = fixture({ "novy-spis": current(novy, "old cli"), "okf-pamat": current(pamat, "old memory cli") });
    await refreshOkfSkills(f.client, "w", [novy, pamat]);
    expect(f.writes).toEqual(["resource:novy-spis/okf.js", "resource:okf-pamat/okf-memory.js"]);
    expect(f.installed["okf-pamat"]?.resources.get("okf-memory.js")).toBe(okfMemoryCliSource());
  });

  test("replaces SKILL.md that equals a previously bundled version", async () => {
    const previous = "# okf-pamat\nOlder bundled text.\n";
    const known = new Set([await okfSkillBodyHash(previous)]);
    const f = fixture({ "okf-pamat": { ...current(pamat), content: stored(previous) } });
    expect(await refreshOkfSkills(f.client, "w", [pamat], known)).toEqual({ modified: [], written: ["okf-pamat"] });
    expect(f.writes).toEqual(["skill:okf-pamat"]);
    expect(await okfSkillBodyHash(f.installed["okf-pamat"]?.content ?? "")).toBe(await okfSkillBodyHash(pamat.body.content));
  });

  test("keeps a customized SKILL.md, reports it, and still refreshes its resource", async () => {
    const custom = stored("# okf-pamat\nMy own instructions.\n");
    const f = fixture({ "okf-pamat": { content: custom, resources: new Map([["okf-memory.js", "old"]]) } });
    expect(await refreshOkfSkills(f.client, "w", [pamat])).toEqual({ modified: ["okf-pamat"], written: [] });
    expect(f.installed["okf-pamat"]?.content).toBe(custom);
    expect(f.writes).toEqual(["resource:okf-pamat/okf-memory.js"]);
  });

  test("never touches a global skill", async () => {
    const f = fixture({ "okf-pamat": { ...current(pamat, "old"), scope: "global" } });
    expect(await refreshOkfSkills(f.client, "w", [pamat])).toEqual({ modified: [], written: [] });
    expect(f.writes).toEqual([]);
  });

  test("a resource the server will not read as text (okf.js, 415) is rewritten instead of failing (D1 2026-10-05)", async () => {
    const f = fixture({ [novy.name]: current(novy, "old cli") });
    f.client.getSkillResource = async () => { throw new Error('415 {"code":"resource_not_text"}'); };
    await expect(refreshOkfSkills(f.client, "ws", [novy])).resolves.toEqual({ modified: [], written: [] });
    expect(f.writes).toEqual([`resource:${novy.name}/${novy.resource}`]);
    expect(f.installed[novy.name]?.resources.get(novy.resource)).toBe(novy.source);
  });

  test("the server's managed resources block is not a customization (D1 2026-10-05)", async () => {
    const block = "\n\n<!-- legalwork:resources:start -->\n## Attached resources\n\n- `resources/okf.js`\n<!-- legalwork:resources:end -->\n";
    expect(BUNDLED_OKF_SKILL_HASHES.has(await okfSkillBodyHash(stored(novy.body.content) + block))).toBe(true);
    const f = fixture({ [novy.name]: { content: stored(novy.body.content) + block, resources: new Map([[novy.resource, novy.source]]) } });
    await expect(refreshOkfSkills(f.client, "ws", [novy])).resolves.toEqual({ modified: [], written: [] });
    expect(f.writes).toEqual([]);
  });
});
