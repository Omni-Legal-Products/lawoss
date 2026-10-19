import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ReloadEventStore } from "./events.js";
import { startReloadWatchers } from "./reload-watcher.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { ensureWorkspaceFiles } from "./workspace-init.js";
import { promoteSkillToWorkflow } from "./github-skills.js";

async function withWorkspace(fn: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "legalwork-reload-watcher-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function buildConfig(root: string): { config: ServerConfig; workspace: WorkspaceInfo } {
  const workspace: WorkspaceInfo = {
    id: "ws_reload_test",
    name: "Reload Test",
    path: root,
    preset: "starter",
    workspaceType: "local",
  };
  return {
    workspace,
    config: {
      host: "127.0.0.1",
      port: 0,
      token: "token",
      hostToken: "host-token",
      approval: { mode: "auto", timeoutMs: 0 },
      corsOrigins: [],
      workspaces: [workspace],
      authorizedRoots: [root],
      readOnly: false,
      startedAt: Date.now(),
      tokenSource: "env",
      hostTokenSource: "env",
      logFormat: "pretty",
      logRequests: false,
    },
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEvent(store: ReloadEventStore, workspaceId: string, since = 0) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const items = store.list(workspaceId, since);
    if (items.length > 0) return items[0];
    await sleep(25);
  }
  return null;
}

describe("reload watcher fingerprints", () => {
  test("promotes an actively watched skill without losing nested resources or later reload events", async () => {
    await withWorkspace(async (root) => {
      const { config, workspace } = buildConfig(root);
      const skill = join(root, ".opencode", "skills", "synthetic");
      await mkdir(join(skill, "resources"), { recursive: true });
      await writeFile(join(skill, "SKILL.md"), "---\nname: synthetic\ndescription: Synthetic watcher fixture\n---\nSynthetic skill\n");
      const bytes = new Uint8Array([0, 255, 17, 128, 10]);
      await writeFile(join(skill, "resources", "sample.bin"), bytes);
      // A nested SKILL.md attachment gives the real watcher a fingerprinted
      // event from the resources directory itself, rather than just its parent.
      const nested = join(skill, "resources", "SKILL.md");
      await writeFile(nested, "Synthetic nested attachment\n");
      const events = new ReloadEventStore();
      const watcher = startReloadWatchers({ config, reloadEvents: events, debounceMs: 30 });
      const observeChange = async (file: string, name: string) => {
        const cursor = events.cursor();
        // Poll actual delivery while changing the content. This acknowledges
        // an armed nested watch without assuming when its initial scan runs.
        for (let attempt = 0; attempt < 60; attempt++) {
          await writeFile(file, `Synthetic nested attachment ${name} revision ${attempt}\n`);
          await sleep(50);
          const event = events.list(workspace.id, cursor).find(item => item.reason === "skills" && item.trigger?.name === name && item.trigger.path === file);
          if (event) return event;
        }
        throw new Error("Nested skill change was not observed by the reload watcher");
      };
      try {
        await watcher.refreshWorkspace(workspace.id);
        const before = await observeChange(nested, "synthetic");
        expect(before.trigger?.path).toBe(nested);
        // The same watcher stays live across this one real rename.
        const promoted = await promoteSkillToWorkflow(root, "synthetic");
        expect(promoted.name).toBe("workflow-assistant-synthetic");
        expect(new Uint8Array(await readFile(join(promoted.path, "resources", "sample.bin")))).toEqual(bytes);
        const after = await observeChange(join(promoted.path, "resources", "SKILL.md"), promoted.name);
        expect(after.seq).toBeGreaterThan(before.seq);
        expect(after.trigger?.name).toBe(promoted.name);
      } finally { watcher.close(); }
    });
  }, 10000);

  test("does not emit when a watched file is rewritten with identical content", async () => {
    await withWorkspace(async (root) => {
      const { config, workspace } = buildConfig(root);
      const configPath = join(root, "opencode.jsonc");
      const content = '{ "plugin": ["demo"] }\n';
      await writeFile(configPath, content, "utf8");

      const events = new ReloadEventStore();
      const watcher = startReloadWatchers({ config, reloadEvents: events, debounceMs: 30 });
      try {
        await watcher.refreshWorkspace(workspace.id);
        await writeFile(configPath, content, "utf8");
        await sleep(120);

        expect(events.list(workspace.id)).toEqual([]);
      } finally {
        watcher.close();
      }
    });
  });

  test("emits when project config content changes while running", async () => {
    await withWorkspace(async (root) => {
      const { config, workspace } = buildConfig(root);
      const configPath = join(root, "opencode.jsonc");
      await writeFile(configPath, '{ "plugin": ["demo"] }\n', "utf8");

      const events = new ReloadEventStore();
      const watcher = startReloadWatchers({ config, reloadEvents: events, debounceMs: 30 });
      try {
        await watcher.refreshWorkspace(workspace.id);
        await writeFile(configPath, '{ "plugin": ["changed"] }\n', "utf8");

        const event = await waitForEvent(events, workspace.id);
        expect(event?.reason).toBe("config");
        expect(event?.trigger?.name).toBe("opencode.jsonc");
      } finally {
        watcher.close();
      }
    });
  });

  test("suppresses internal workspace bootstrap writes after refreshing the baseline", async () => {
    await withWorkspace(async (root) => {
      const { config, workspace } = buildConfig(root);
      const events = new ReloadEventStore();
      const watcher = startReloadWatchers({ config, reloadEvents: events, debounceMs: 100 });
      try {
        await watcher.refreshWorkspace(workspace.id);
        const ensured = await watcher.withWorkspaceBootstrap(workspace.id, async () => {
          const result = await ensureWorkspaceFiles(root, "starter");
          // The producer may still be repairing bundled files when native watch
          // notifications arrive; bootstrap must not depend on beating debounce.
          await sleep(450);
          expect(events.list(workspace.id)).toEqual([]);
          return result;
        });
        await sleep(250);

        expect(ensured.reloadReasons.sort()).toEqual(["agents", "commands", "skills"]);
        expect(events.list(workspace.id)).toEqual([]);
        await writeFile(join(root, "AGENTS.md"), "External edit after bootstrap\n");
        expect((await waitForEvent(events, workspace.id))?.reason).toBe("agents");
      } finally {
        watcher.close();
      }
    });
  });

  test("overlapping and nested bootstrap scopes retain only their workspace's bundled reasons", async () => {
    await withWorkspace(async root => {
      const { config, workspace } = buildConfig(root);
      const otherRoot = join(root, "other-project");
      await mkdir(otherRoot);
      const pluginPath = join(root, ".opencode", "plugins", "synthetic.mjs");
      await mkdir(join(root, ".opencode", "plugins"), { recursive: true });
      await writeFile(pluginPath, "export const synthetic = 1;\n");
      const other = { ...workspace, id: "other-project", path: otherRoot };
      config.workspaces.push(other);
      const events = new ReloadEventStore();
      const watcher = startReloadWatchers({ config, reloadEvents: events, debounceMs: 30 });
      let releaseFirst = () => {}, releaseSecond = () => {};
      const firstHeld = new Promise<void>(resolve => { releaseFirst = resolve; });
      const secondHeld = new Promise<void>(resolve => { releaseSecond = resolve; });
      let first: Promise<void> | undefined, second: Promise<void> | undefined;
      try {
        await watcher.refreshWorkspace(workspace.id);
        await watcher.refreshWorkspace(other.id);
        first = watcher.withWorkspaceBootstrap(workspace.id, async () => {
          await watcher.withWorkspaceBootstrap(workspace.id, async () => {
            await writeFile(join(root, "AGENTS.md"), "Nested internal bootstrap\n");
          });
          await firstHeld;
        });
        second = watcher.withWorkspaceBootstrap(workspace.id, async () => { await secondHeld; });
        releaseFirst(); await first;
        await writeFile(join(root, "AGENTS.md"), "Still inside concurrent bootstrap\n");
        await sleep(120);
        expect(events.list(workspace.id)).toEqual([]);
        await writeFile(join(otherRoot, "AGENTS.md"), "Other project's visible edit\n");
        expect((await waitForEvent(events, other.id))?.reason).toBe("agents");
        await writeFile(join(root, "opencode.jsonc"), '{ "plugin": ["external"] }\n');
        expect((await waitForEvent(events, workspace.id))?.reason).toBe("config");
        const pluginCursor = events.cursor();
        await writeFile(pluginPath, "export const synthetic = 2;\n");
        expect((await waitForEvent(events, workspace.id, pluginCursor))?.reason).toBe("plugins");
        releaseSecond(); await second;
        const cursor = events.cursor();
        await writeFile(join(root, "AGENTS.md"), "External edit after both producers\n");
        expect((await waitForEvent(events, workspace.id, cursor))?.reason).toBe("agents");
      } finally {
        releaseFirst(); releaseSecond();
        await Promise.allSettled([first, second]);
        watcher.close();
      }
    });
  });

  test("a failed bootstrap refreshes its partial writes and releases suppression without replacing its error", async () => {
    await withWorkspace(async root => {
      const { config, workspace } = buildConfig(root);
      const events = new ReloadEventStore();
      const watcher = startReloadWatchers({ config, reloadEvents: events, debounceMs: 30 });
      const failure = new Error("Synthetic bootstrap failure");
      try {
        await watcher.refreshWorkspace(workspace.id);
        await expect(watcher.withWorkspaceBootstrap(workspace.id, async () => {
          await writeFile(join(root, "AGENTS.md"), "Partial internal bootstrap\n");
          await sleep(120);
          throw failure;
        })).rejects.toBe(failure);
        await sleep(120);
        expect(events.list(workspace.id)).toEqual([]);
        await writeFile(join(root, "AGENTS.md"), "Visible edit after failed bootstrap\n");
        expect((await waitForEvent(events, workspace.id))?.reason).toBe("agents");
      } finally { watcher.close(); }
    });
  });

  test.each([false, true])("a restarted watcher retains bootstrap and refreshes the live generation (initial watcher missing: %s)", async initiallyMissing => {
    await withWorkspace(async root => {
      const { config, workspace } = buildConfig(root);
      if (initiallyMissing) config.workspaces = [];
      const events = new ReloadEventStore();
      let watcher = startReloadWatchers({ config, reloadEvents: events, debounceMs: 30 });
      if (initiallyMissing) config.workspaces.push(workspace);
      let release = () => {}, entered = () => {};
      const held = new Promise<void>(resolve => { release = resolve; });
      const writing = new Promise<void>(resolve => { entered = resolve; });
      let bootstrap: Promise<void> | undefined;
      try {
        await watcher.refreshWorkspace(workspace.id);
        bootstrap = watcher.withWorkspaceBootstrap(workspace.id, async () => {
          await writeFile(join(root, "AGENTS.md"), "First internal bootstrap write\n");
          entered(); await held;
        });
        await writing;
        watcher.close();
        watcher = startReloadWatchers({ config, reloadEvents: events, debounceMs: 30 });
        await watcher.refreshWorkspace(workspace.id);
        await writeFile(join(root, "AGENTS.md"), "Internal write after project-sync restarted watchers\n");
        await sleep(120);
        expect(events.list(workspace.id)).toEqual([]);
        release(); await bootstrap;
        await sleep(120);
        expect(events.list(workspace.id)).toEqual([]);
        await writeFile(join(root, "AGENTS.md"), "External edit in the live generation\n");
        expect((await waitForEvent(events, workspace.id))?.reason).toBe("agents");
      } finally {
        release(); await bootstrap;
        watcher.close();
      }
    });
  });

  test("a replacement root with the same project ID does not inherit its former root's bootstrap scope", async () => {
    await withWorkspace(async root => {
      const { config, workspace } = buildConfig(root);
      const otherRoot = join(root, "replacement");
      await mkdir(otherRoot);
      const events = new ReloadEventStore();
      let watcher = startReloadWatchers({ config, reloadEvents: events, debounceMs: 30 });
      let release = () => {}, entered = () => {};
      const held = new Promise<void>(resolve => { release = resolve; });
      const writing = new Promise<void>(resolve => { entered = resolve; });
      let bootstrap: Promise<void> | undefined;
      try {
        await watcher.refreshWorkspace(workspace.id);
        bootstrap = watcher.withWorkspaceBootstrap(workspace.id, async () => {
          await writeFile(join(root, "AGENTS.md"), "Former root's internal bootstrap\n");
          entered(); await held;
        });
        await writing;
        watcher.close();
        config.workspaces = [{ ...workspace, path: otherRoot }];
        watcher = startReloadWatchers({ config, reloadEvents: events, debounceMs: 30 });
        await watcher.refreshWorkspace(workspace.id);
        await writeFile(join(otherRoot, "AGENTS.md"), "Replacement root's visible edit\n");
        expect((await waitForEvent(events, workspace.id))?.trigger?.path).toBe(join(otherRoot, "AGENTS.md"));
      } finally {
        release(); await bootstrap;
        watcher.close();
      }
    });
  });

  test("watches hidden project opencode config files", async () => {
    await withWorkspace(async (root) => {
      const { config, workspace } = buildConfig(root);
      await mkdir(join(root, ".opencode"), { recursive: true });

      const events = new ReloadEventStore();
      const watcher = startReloadWatchers({ config, reloadEvents: events, debounceMs: 30 });
      try {
        await watcher.refreshWorkspace(workspace.id);
        await sleep(75);
        await writeFile(join(root, ".opencode", "opencode.jsonc"), '{ "mcp": {} }\n', "utf8");

        const event = await waitForEvent(events, workspace.id);
        expect(event?.reason).toBe("config");
        expect(event?.trigger?.name).toBe("opencode.jsonc");
      } finally {
        watcher.close();
      }
    });
  });
});

// 🟡 LAWOSS: watcher vytvorený počas prehľadávania stromu po close() ostal
// otvorený navždy. Na Windows tak držal priečinok (EBUSY pri mazaní, „priečinok
// používa iný program“ v Prieskumníkovi). Linux ukáže sledovania v /proc.
function inotifyWatchCount(): number {
  return readdirSync("/proc/self/fdinfo").reduce((total, fd) => {
    try {
      return total + (readFileSync(`/proc/self/fdinfo/${fd}`, "utf8").match(/^inotify wd:/gm)?.length ?? 0);
    } catch {
      return total;
    }
  }, 0);
}

describe("reload watcher close", () => {
  test.skipIf(!existsSync("/proc/self/fdinfo"))("close() during the first tree scan leaves no watcher behind", async () => {
    await withWorkspace(async (root) => {
      const { config } = buildConfig(root);
      for (let index = 0; index < 120; index += 1) {
        await mkdir(join(root, ".opencode", "skills", `skill-${index}`, "references"), { recursive: true });
      }
      const baseline = inotifyWatchCount();
      for (let delay = 196; delay <= 260; delay += 4) {
        const watcher = startReloadWatchers({ config, reloadEvents: new ReloadEventStore(), debounceMs: 30 });
        await sleep(delay);
        watcher.close();
        await sleep(150);
        expect({ delay, watches: inotifyWatchCount() }).toEqual({ delay, watches: baseline });
      }
    });
  }, 30_000);
});
