import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCode } from "@opencode/client";
import { createManagedOpencodeServer } from "../managed-opencode.js";
import type { ServerConfig } from "../types.js";
import { LAWOSS_DISABLED_ENGINE_PLUGINS } from "./engine-foreign-skills.js";
import { engineProjectStopEnv } from "./engine-project-stop.js";

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

const agent = (name: string) => `---\ndescription: Fixture agent ${name}.\nmode: subagent\n---\nFixture.\n`;

/** Watcher lines whose subscribed path is exactly one of `paths` (the client lies below the parent, so no prefix match). */
async function exactSubscriptions(dataHome: string, paths: readonly string[]) {
  const directory = join(dataHome, "opencode", "log");
  const files = await readdir(directory).catch(() => []);
  const text = (await Promise.all(files.map((file) => readFile(join(directory, file), "utf8")))).join("\n");
  const lines = text.split("\n").filter((line) => line.includes("watcher subscribe"));
  return { logged: lines.length > 0, lines: lines.filter((line) => paths.some((path) => new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w./-])`).test(line))) };
}

/**
 * #530: `.opencode` of a folder above the client (the stand-in for the user's real home, e.g. `~/.opencode`).
 * The client and a matter inside it are both locations; the client's own `.opencode` must still load.
 */
async function probeProjectConfig(root: string, stop: boolean) {
  const run = await realpath(await mkdtemp(join(root, "run-")));
  const parent = join(run, "home"), client = join(parent, "Documents", "Klient"), matter = join(client, "Spisy", "Vec-1");
  const engineHome = join(run, "engine-home");
  await writeSkill(join(parent, ".opencode", "skills"), "parent-opencode");
  await mkdir(join(parent, ".opencode", "agent"), { recursive: true });
  await writeFile(join(parent, ".opencode", "agent", "parent-agent.md"), agent("parent-agent"));
  await mkdir(join(client, ".opencode", "agent"), { recursive: true });
  await writeFile(join(client, ".opencode", "agent", "client-agent.md"), agent("client-agent"));
  await mkdir(matter, { recursive: true });
  await Promise.all(["config", "data", "state", "cache"].map((name) => mkdir(join(engineHome, name), { recursive: true })));
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, configPath: join(run, "server", "server.json"), token: "owt_project_stop", hostToken: "owt_project_stop_host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], workspaces: [{ id: "ws_klient", name: "Klient", path: client, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [client], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const engine = await createManagedOpencodeServer({ bin: process.env.LEGALWORK_TEST_OPENCODE_BIN, cwd: engineHome, timeoutMs: 30_000, env: {
    HOME: engineHome, USERPROFILE: engineHome, OPENCODE_TEST_HOME: engineHome,
    XDG_CONFIG_HOME: join(engineHome, "config"), XDG_DATA_HOME: join(engineHome, "data"), XDG_STATE_HOME: join(engineHome, "state"), XDG_CACHE_HOME: join(engineHome, "cache"),
    OPENCODE_CONFIG_DIR: join(engineHome, "config"), OPENCODE_DB: join(run, "engine.db"), OPENCODE_CONFIG_PROJECT_DISABLE: "",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ update: "disable", warming: false, plugins: ["-opencode.config.command", ...LAWOSS_DISABLED_ENGINE_PLUGINS] }),
    // As `createConfiguredManagedEngine` does for every engine start.
    ...(stop ? await engineProjectStopEnv(config, engineHome) : { OPENCODE_CONFIG_PROJECT_STOP: "" }),
  } });
  try {
    const api = OpenCode.make({ baseUrl: engine.url, headers: { authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}` } });
    const seen = async (directory: string) => {
      const location = { directory };
      await api.model.list({ location });
      return {
        skills: (await api.skill.list({ location })).data.map((item) => item.id),
        agents: (await api.agent.list({ location })).data.map((item) => item.id),
      };
    };
    const atClient = await seen(client), atMatter = await seen(matter);
    await Bun.sleep(300);
    return { atClient, atMatter, parent, log: join(engineHome, "data") };
  } finally {
    await engine.close();
  }
}

test.skipIf(!process.env.LEGALWORK_TEST_OPENCODE_BIN)("#530: engine nenačíta ani nesleduje .opencode nadradených priečinkov klienta, .opencode klienta áno", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-project-stop-")));
  try {
    // Control (same binary, no boundary): the walk loads and watches the parent's `.opencode`.
    const upstream = await probeProjectConfig(root, false);
    expect(upstream.atClient.skills).toContain("parent-opencode");
    expect(upstream.atClient.agents).toContain("parent-agent");
    expect(upstream.atClient.agents).toContain("client-agent");
    expect((await exactSubscriptions(upstream.log, [upstream.parent, join(upstream.parent, ".opencode")])).lines.length).toBeGreaterThan(0);

    const lawoss = await probeProjectConfig(root, true);
    for (const seen of [lawoss.atClient, lawoss.atMatter]) {
      expect(seen.skills).not.toContain("parent-opencode");
      expect(seen.agents).not.toContain("parent-agent");
      // The client's own `.opencode` still loads, also for a matter inside the client.
      expect(seen.agents).toContain("client-agent");
    }
    const watches = await exactSubscriptions(lawoss.log, [lawoss.parent, join(lawoss.parent, ".opencode")]);
    expect(watches.logged).toBe(true);
    expect(watches.lines).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
