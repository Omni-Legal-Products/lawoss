import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCode } from "@opencode/client";
import { createManagedOpencodeServer } from "../managed-opencode.js";
import { LAWOSS_DISABLED_ENGINE_PLUGINS } from "./engine-foreign-skills.js";

const skill = (name: string) => `---\nname: ${name}\ndescription: Fixture skill ${name}.\n---\nFixture.\n`;
async function writeSkill(directory: string, name: string) {
  await mkdir(join(directory, name), { recursive: true });
  await writeFile(join(directory, name, "SKILL.md"), skill(name));
}

/** Lines of the engine's own log that subscribe a watcher under `prefix`. */
async function subscriptions(dataHome: string, prefix: string) {
  const directory = join(dataHome, "opencode", "log");
  const files = await readdir(directory).catch(() => []);
  const text = (await Promise.all(files.map((file) => readFile(join(directory, file), "utf8")))).join("\n");
  return { logged: text.includes("watcher subscribe"), lines: text.split("\n").filter((line) => line.includes("watcher subscribe") && line.includes(prefix)) };
}

/**
 * #530: a client folder below another folder (here the stand-in for the user's real home) that holds
 * `.claude/skills` and `.agents/skills`. The engine runs with its own home, as in the app.
 */
async function probe(root: string, directives: readonly string[]) {
  const run = await realpath(await mkdtemp(join(root, "run-")));
  const parent = join(run, "home"), client = join(parent, "Documents", "Klient");
  const engineHome = join(run, "engine-home");
  await writeSkill(join(parent, ".claude", "skills"), "parent-claude");
  await writeSkill(join(parent, ".agents", "skills"), "parent-agents");
  await writeSkill(join(client, ".claude", "skills"), "client-claude");
  await Promise.all(["config", "data", "state", "cache"].map((name) => mkdir(join(engineHome, name), { recursive: true })));
  const engine = await createManagedOpencodeServer({ bin: process.env.LEGALWORK_TEST_OPENCODE_BIN, cwd: engineHome, timeoutMs: 30_000, env: {
    HOME: engineHome, USERPROFILE: engineHome, OPENCODE_TEST_HOME: engineHome,
    XDG_CONFIG_HOME: join(engineHome, "config"), XDG_DATA_HOME: join(engineHome, "data"), XDG_STATE_HOME: join(engineHome, "state"), XDG_CACHE_HOME: join(engineHome, "cache"),
    OPENCODE_CONFIG_DIR: join(engineHome, "config"), OPENCODE_DB: join(run, "engine.db"), OPENCODE_CONFIG_PROJECT_DISABLE: "",
    // As the server does: the client's own `.claude/skills` arrive as explicit skill paths (legalwork-runtime-config.ts).
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ update: "disable", warming: false, skills: [join(client, ".claude", "skills", "client-claude")], plugins: ["-opencode.config.command", ...directives] }),
  } });
  try {
    const api = OpenCode.make({ baseUrl: engine.url, headers: { authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}` } });
    const location = { directory: client };
    await api.model.list({ location });
    const skills = (await api.skill.list({ location })).data.map((item) => item.id);
    const plugins = (await api.plugin.list({ location })).data;
    await Bun.sleep(300);
    return { skills, compatibility: plugins.some((plugin) => plugin.id === "opencode.config.compatibility"), parent, log: join(engineHome, "data") };
  } finally {
    await engine.close();
  }
}

test.skipIf(!process.env.LEGALWORK_TEST_OPENCODE_BIN)("#530: engine nenačíta ani nesleduje .claude/.agents skilly nadradených priečinkov mimo profilu", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-foreign-skills-")));
  try {
    // Control: the upstream compatibility plugin reads and watches `.agents/skills` of every parent folder.
    const upstream = await probe(root, []);
    expect(upstream.compatibility).toBe(true);
    expect(upstream.skills).toContain("parent-agents");
    const upstreamWatches = await subscriptions(upstream.log, join(upstream.parent, ".agents"));
    expect(upstreamWatches.lines.length).toBeGreaterThan(0);

    const lawoss = await probe(root, LAWOSS_DISABLED_ENGINE_PLUGINS);
    expect(lawoss.compatibility).toBe(false);
    expect(lawoss.skills).not.toContain("parent-agents");
    expect(lawoss.skills).not.toContain("parent-claude");
    // The client's own skills still reach the engine through the explicit path.
    expect(lawoss.skills).toContain("client-claude");
    const watches = await subscriptions(lawoss.log, lawoss.parent);
    expect(watches.logged).toBe(true);
    expect(watches.lines.filter((line) => line.includes(join(lawoss.parent, ".claude")) || line.includes(join(lawoss.parent, ".agents")))).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
