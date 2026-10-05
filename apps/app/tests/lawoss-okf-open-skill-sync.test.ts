import { describe, expect, test } from "bun:test";
import { novySpisSkillBody, okfCliSource } from "../src/lawoss/okf/skill-bundle";
import { clientTitleOf, resolveOpenClient, type OpenClientWorkspace } from "../src/lawoss/okf/open-client";
import { shouldNotifyModified, syncOkfSkillsForOpenWorkspace, type OkfSkillSyncClient } from "../src/lawoss/okf/workspace-skill-sync";

const ws = (id: string, path: string, extra: Partial<OpenClientWorkspace> = {}): OpenClientWorkspace => ({ id, path, name: path.split("/").pop() ?? id, workspaceType: "local", ...extra });
const CLIENT = ws("client", "/Users/test/Klienti/Vzorový klient s. r. o.");
const MATTER = ws("matter", "/Users/test/Klienti/Vzorový klient s. r. o./Spisy/2026-10 Žaloba");
const LOOSE = ws("loose", "/Users/test/Dokumenty");
const OKF_ON = { enabled: true as const, acknowledgedAt: "2026-10-05T08:00:00.000Z", noticeVersion: "2026-10-04-alfa-1" };

type Skill = { content: string; resources: Map<string, string> };
function fixture(options: { okf?: boolean; files?: Record<string, string[]>; skills?: Record<string, Record<string, Skill>>; writable?: boolean } = {}) {
  const files = options.files ?? { client: ["client.md", "AGENTS.md"], matter: ["matter.md"], loose: ["poznamky.txt"] };
  const skills = options.skills ?? {};
  const writes: string[] = [];
  const store = (id: string) => (skills[id] ??= {});
  const client: OkfSkillSyncClient = {
    onboardingStatus: async () => ({ profile: { version: 1, lawyerName: "Test", jurisdiction: "sk", language: "sk", ...(options.okf === false ? { okf: { enabled: false } } : { okf: OKF_ON }) }, capabilities: { map: true, trialClone: true } }),
    capabilities: async () => ({ skills: { write: options.writable !== false }, skillResources: { write: options.writable !== false } }) as Awaited<ReturnType<OkfSkillSyncClient["capabilities"]>>,
    listWorkspaceDirectory: async (id, path) => {
      if (!files[id]) throw new Error("404 not found");
      return { path, truncated: false, entries: files[id].map((name) => ({ name, path: name, kind: "file" as const })) };
    },
    readWorkspaceFile: async (id, path) => ({ path, content: id === "client" && path === "client.md" ? "---\ntype: client\ntitle: Vzorový klient s. r. o.\n---\n" : "" }) as Awaited<ReturnType<OkfSkillSyncClient["readWorkspaceFile"]>>,
    listSkills: async (id) => ({ items: Object.keys(store(id)).map((name) => ({ name, path: `/${name}`, description: "", scope: "project" as const })), skipped: [] }),
    getSkill: async (id, name) => ({ item: { name, path: `/${name}`, description: "", scope: "project" }, content: store(id)[name]?.content ?? "" }),
    upsertSkill: async (id, payload) => {
      writes.push(`${id}:skill:${payload.name}`);
      store(id)[payload.name] = { content: `---\nname: ${payload.name}\n---\n${payload.content}`, resources: store(id)[payload.name]?.resources ?? new Map() };
      return { name: payload.name, path: "/", description: "", scope: "project" };
    },
    listSkillResources: async (id, skill) => ({ items: [...(store(id)[skill]?.resources.keys() ?? [])].map((name) => ({ name, path: `/${name}`, size: 1, updatedAt: 0 })) }),
    getSkillResource: async (id, skill, name) => ({ item: { name, path: `/${name}`, size: 1, updatedAt: 0 }, content: store(id)[skill]?.resources.get(name) ?? "" }),
    upsertSkillResource: async (id, skill, payload) => {
      writes.push(`${id}:resource:${skill}/${payload.name}`);
      store(id)[skill]?.resources.set(payload.name, payload.content ?? "");
      return { ok: true, name: payload.name, path: "/", action: "added" };
    },
  };
  return { client, writes, skills };
}

describe("open OKF client", () => {
  test("a workspace with a client card is the client, named from its card", async () => {
    const f = fixture();
    expect(await resolveOpenClient(f.client, [CLIENT, MATTER], "client")).toEqual({ workspaceId: "client", root: CLIENT.path, title: "Vzorový klient s. r. o." });
  });

  test("a matter opened on its own resolves to its registered client", async () => {
    const f = fixture();
    expect((await resolveOpenClient(f.client, [MATTER, CLIENT], "matter"))?.workspaceId).toBe("client");
  });

  test("no guessing outside registered clients, plain folders and remote workspaces", async () => {
    const f = fixture();
    expect(await resolveOpenClient(f.client, [MATTER], "matter")).toBeNull();
    expect(await resolveOpenClient(f.client, [LOOSE, CLIENT], "loose")).toBeNull();
    expect(await resolveOpenClient(f.client, [ws("client", CLIENT.path, { workspaceType: "remote" })], "client")).toBeNull();
    expect(await resolveOpenClient(f.client, [ws("gone", "/nowhere")], "gone")).toBeNull();
    expect(await resolveOpenClient(f.client, [CLIENT], null)).toBeNull();
  });

  test("the title of a saved client comes from its workspace, else from the folder name", async () => {
    const f = fixture();
    expect(await clientTitleOf(f.client, [CLIENT], `${CLIENT.path}/`)).toBe("Vzorový klient s. r. o.");
    expect(await clientTitleOf(f.client, [CLIENT], "/Users/test/Klienti/Iný klient")).toBe("Iný klient");
  });
});

describe("OKF skills when a client is opened", () => {
  test("installs the missing skills into the client and is idempotent", async () => {
    const f = fixture();
    expect(await syncOkfSkillsForOpenWorkspace(f.client, [CLIENT], "client", "sk")).toEqual({ status: "refreshed", workspaceId: "client", modified: [] });
    expect(f.writes).toEqual([
      "client:skill:novy-spis", "client:resource:novy-spis/okf.js",
      "client:skill:okf-pamat", "client:resource:okf-pamat/okf-memory.js",
      "client:skill:usporiadaj-spis", "client:resource:usporiadaj-spis/okf.js",
    ]);
    f.writes.length = 0;
    await syncOkfSkillsForOpenWorkspace(f.client, [CLIENT], "client", "sk");
    expect(f.writes).toEqual([]);
  });

  test("a matter under a registered client refreshes the client, never the matter", async () => {
    const f = fixture();
    await syncOkfSkillsForOpenWorkspace(f.client, [CLIENT, MATTER], "matter", "sk");
    expect(f.writes.length).toBeGreaterThan(0);
    expect(f.writes.every((write) => write.startsWith("client:"))).toBe(true);
  });

  test("keeps a customized SKILL.md, refreshes its tool and reports it", async () => {
    const custom = "---\nname: novy-spis\n---\nPravidlá našej kancelárie.\n";
    const f = fixture({ skills: { client: { "novy-spis": { content: custom, resources: new Map([["okf.js", "stará verzia"]]) } } } });
    const result = await syncOkfSkillsForOpenWorkspace(f.client, [CLIENT], "client", "sk");
    expect(result).toEqual({ status: "refreshed", workspaceId: "client", modified: ["novy-spis"] });
    expect(f.skills.client?.["novy-spis"]?.content).toBe(custom);
    expect(f.skills.client?.["novy-spis"]?.resources.get("okf.js")).toBe(okfCliSource());
  });

  test("a current SKILL.md is not rewritten", async () => {
    const current = `---\nname: novy-spis\n---\n${novySpisSkillBody("sk").content}`;
    const f = fixture({ skills: { client: { "novy-spis": { content: current, resources: new Map([["okf.js", okfCliSource()]]) } } } });
    await syncOkfSkillsForOpenWorkspace(f.client, [CLIENT], "client", "sk");
    expect(f.writes.some((write) => write === "client:skill:novy-spis")).toBe(false);
  });

  test("does nothing without OKF, outside a client or without write access", async () => {
    for (const [options, id, reason] of [[{ okf: false }, "client", "okf_off"], [{}, "loose", "not_client"], [{ writable: false }, "client", "read_only"]] as const) {
      const f = fixture(options);
      expect(await syncOkfSkillsForOpenWorkspace(f.client, [CLIENT, LOOSE], id, "sk")).toEqual({ status: "skipped", reason });
      expect(f.writes).toEqual([]);
    }
  });

  test("the notice about kept customizations appears once per workspace and list", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), removeItem: (key: string) => void data.delete(key) };
    expect(shouldNotifyModified(storage, "client", ["novy-spis"])).toBe(true);
    expect(shouldNotifyModified(storage, "client", ["novy-spis"])).toBe(false);
    expect(shouldNotifyModified(storage, "client", ["okf-pamat", "novy-spis"])).toBe(true);
    expect(shouldNotifyModified(storage, "client", [])).toBe(false);
    expect(shouldNotifyModified(storage, "client", ["novy-spis"])).toBe(true);
  });
});
