import { scheduleTaskSync, startTaskSyncTimer } from "./task-sync.js";
import { startProjectSyncTimer } from "./project-sync.js";
import { acquireRuntimeDbLifetime } from "./runtime-db-lifecycle.js";
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectField, ProjectSyncSettings } from "@legalwork/types/workspace";

import { writeEigenweltConnection } from "./eigenwelt-connection-store.js";
import type { IntakeClient } from "./eigenwelt-intake.js";
import type { RemoteProject } from "./eigenwelt-projects.js";
import { ApiError } from "./errors.js";
import { checkCondition, conflict, entry, type StorageAdapter } from "./file-storage/common.js";
import { readProjectDetails, updateProjectDetails, updateProjectPersonalization, updateProjectRemote } from "./project-store.js";
import { projectSyncStore } from "./project-sync-store.js";
import {
  diffFields,
  noteProjectDetailsSaved,
  noteProjectPersonalizationSaved,
  noteProjectFoldersChanged,
  noteProjectRenamed,
  projectSyncOverview,
  projectSyncStatus,
  resolveProjectSync,
  runProjectSync,
  scheduleProjectSync,
  saveProjectSyncSettings,
  stopProjectSync,
  type ProjectSyncPlatform,
} from "./project-sync.js";
import { ReviewStore } from "./reviews/storage.js";
import { registerLocalProject } from "./routes/workspaces.js";
import { taskStore } from "./task-store.js";
import { createProjectSyncFirstFailureTiming, type ProjectSyncFirstFailureTiming } from "./test-support/project-sync-first-failure-timing.js";
import type { RecorderBridge, ServerConfig, WorkspaceInfo } from "./types.js";

const ORG = "org_kanzlei";
const cleanups: Array<() => Promise<void>> = [];
let activeFirstFailureTiming: ProjectSyncFirstFailureTiming | undefined;
const originalPlatformUrl = process.env.EIGENWELT_PLATFORM_URL;
const originalRuntimeDb = process.env.LEGALWORK_RUNTIME_DB;

beforeAll(() => {
  process.env.EIGENWELT_PLATFORM_URL = "https://platform.test";
  // Each machine keeps its runtime DB beside its own config.
  delete process.env.LEGALWORK_RUNTIME_DB;
});
afterAll(() => {
  if (originalPlatformUrl === undefined) delete process.env.EIGENWELT_PLATFORM_URL;
  else process.env.EIGENWELT_PLATFORM_URL = originalPlatformUrl;
  if (originalRuntimeDb !== undefined) process.env.LEGALWORK_RUNTIME_DB = originalRuntimeDb;
});
afterEach(async () => {
  const observer = activeFirstFailureTiming;
  activeFirstFailureTiming = undefined;
  observer?.cleanupEntry(cleanups.length);
  try {
    while (cleanups.length) await cleanups.pop()?.();
  } catch (error) {
    observer?.cleanupExit(true, cleanups.length);
    throw error;
  }
  observer?.cleanupExit(false, cleanups.length);
});

const ALL = { documents: true, notes: true, tasks: true, recordings: false, metadata: true, reviews: true };

/**
 * The firm's platform, in memory: who sees which project, as the real access
 * rule has it (owner, listed members, or everyone for `org`), and each
 * project's documents with their sha256 as version.
 */
function fakeFirm() {
  // Synthetic server revisions must precede real local edit timestamps on every runner.
  let clock = Date.now() - 60 * 60 * 1000;
  const tick = () => new Date((clock += 1000)).toISOString();
  type Stored = {
    record: Omit<RemoteProject, "role">;
    deleted: boolean;
    personalizationAt: string | null;
    files: Map<string, { path: string; bytes: Buffer }>;
  };
  const projects = new Map<string, Stored>();
  const userOf = (client: IntakeClient) => client.platformToken.replace(/^tok_/, "");
  const visible = (stored: Stored, userId: string) =>
    !stored.deleted &&
    (stored.record.access === "org" || stored.record.ownerUserId === userId || stored.record.memberIds.includes(userId));
  const wire = (stored: Stored, userId: string): RemoteProject => ({
    ...stored.record,
    fields: stored.record.scope.metadata ? stored.record.fields : [],
    personalizationPrompt: stored.record.scope.metadata ? stored.record.personalizationPrompt ?? null : null,
    role: stored.record.ownerUserId === userId ? "owner" : "member",
  });
  const lookup = (client: IntakeClient, id: string) => {
    const stored = projects.get(id);
    if (!stored || !visible(stored, userOf(client))) throw new ApiError(404, "intake_not_found", "no such project");
    return stored;
  };
  const version = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

  const platform: ProjectSyncPlatform = {
    listProjects: async (client, params) => {
      const userId = userOf(client);
      const since = params.updatedSince ?? "";
      const changed = [...projects.values()].filter((stored) => stored.record.updatedAt > since);
      return {
        projects: changed.filter((stored) => visible(stored, userId)).map((stored) => wire(stored, userId)),
        nextCursor: null,
        hidden: params.updatedSince ? changed.filter((stored) => !visible(stored, userId)).map((stored) => stored.record.id) : [],
      };
    },
    createProject: async (client, input) => {
      const now = tick();
      const stored: Stored = {
        record: { ...input, ownerUserId: userOf(client), createdAt: now, updatedAt: now },
        deleted: false,
        personalizationAt: input.personalizationPrompt === undefined ? null : now,
        files: projects.get(input.id)?.files ?? new Map(),
      };
      projects.set(input.id, stored);
      return wire(stored, userOf(client));
    },
    patchProject: async (client, id, patch) => {
      const stored = lookup(client, id);
      const now = tick();
      const scope = patch.scope ?? stored.record.scope;
      let personalizationPrompt = scope.metadata ? stored.record.personalizationPrompt ?? null : null;
      const applied: string[] = [];
      if (!scope.metadata) stored.personalizationAt = null;
      if (scope.metadata && patch.personalizationPrompt !== undefined && (patch.changedAt ?? now) >= (stored.personalizationAt ?? "")) {
        personalizationPrompt = patch.personalizationPrompt;
        stored.personalizationAt = patch.changedAt ?? now;
        applied.push("personalization");
      }
      const fields = [...stored.record.fields];
      for (const change of patch.fieldChanges ?? []) {
        const index = fields.findIndex((field) => field.id === change.id);
        if (change.field === null) {
          if (index >= 0) fields.splice(index, 1);
        } else if (index >= 0) fields[index] = change.field;
        else fields.push(change.field);
      }
      stored.record = {
        ...stored.record,
        name: patch.name ?? stored.record.name,
        remote: patch.remote ?? stored.record.remote,
        fields,
        personalizationPrompt,
        access: patch.access ?? stored.record.access,
        memberIds: patch.memberIds ?? stored.record.memberIds,
        scope,
        updatedAt: now,
      };
      return { project: wire(stored, userOf(client)), applied };
    },
    deleteProject: async (client, id) => {
      const stored = lookup(client, id);
      stored.deleted = true;
      stored.files.clear();
      stored.record = { ...stored.record, updatedAt: tick() };
    },
    storage: (client, projectId): StorageAdapter => {
      const files = () => lookup(client, projectId).files;
      const touch = () => {
        const stored = lookup(client, projectId);
        stored.record = { ...stored.record, updatedAt: tick() };
      };
      return {
        list: async () => ({ entries: [] }),
        listFiles: async (prefix) => ({
          entries: [...files().values()].filter((file) => !prefix || file.path.startsWith(`${prefix}/`)).map((file) => ({
            ...entry(file.path, "file", file.bytes.byteLength, null),
            version: version(file.bytes),
          })),
        }),
        stat: async () => null,
        read: async () => {
          throw new Error("not used");
        },
        download: async (path, destination) => {
          const file = files().get(path.toLowerCase());
          if (!file || destination === undefined) throw new ApiError(404, "intake_not_found", "no such file");
          await writeFile(destination, file.bytes, { flag: "wx" });
          return { size: file.bytes.byteLength, version: version(file.bytes), sha256: version(file.bytes) };
        },
        write: async (path, data, _contentType, condition) => {
          const current = files().get(path.toLowerCase());
          checkCondition(current ? { size: current.bytes.byteLength, version: version(current.bytes) } : null, condition);
          files().set(path.toLowerCase(), { path, bytes: data });
          touch();
        },
        upload: async (path, source, _contentType, condition) => {
          const current = files().get(path.toLowerCase());
          checkCondition(current ? { size: current.bytes.byteLength, version: version(current.bytes) } : null, condition);
          files().set(path.toLowerCase(), { path, bytes: typeof source === "string" ? await readFile(source) : source });
          touch();
        },
        mkdir: async () => {},
        deleteFile: async (path, condition) => {
          const current = files().get(path.toLowerCase());
          if (!current) return;
          if (condition?.version && condition.version !== version(current.bytes)) conflict();
          files().delete(path.toLowerCase());
          touch();
        },
      };
    },
  };
  return { platform, projects };
}

/** One member's computer: its own server config, runtime DB and projects folder. */
async function machine(userId: string, userName: string, options: { syncMode?: "manual" | "background" } = {}) {
  const dir = await mkdtemp(join(tmpdir(), `legalwork-${userId}-`));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const config = {
    configPath: join(dir, "server.json"),
    workspaces: [],
    authorizedRoots: [],
    projectsDirectory: join(dir, "Projects"),
  } as unknown as ServerConfig;
  const lifetime = acquireRuntimeDbLifetime(config);
  cleanups.push(() => lifetime.release());
  const stopTaskTimer = startTaskSyncTimer(config, 60_000, 60_000);
  cleanups.push(stopTaskTimer);
  const stopProjectTimer = startProjectSyncTimer(config, 60_000, 60_000);
  cleanups.push(stopProjectTimer);
  await writeEigenweltConnection(config, {
    platformToken: `tok_${userId}`,
    account: { userId, userName, userEmail: `${userId}@kanzlei.test`, orgId: ORG, orgName: "Kanzlei" },
  });
  // Manual rounds retain the DB lifetime, but automatic producers must be stopped.
  if (options.syncMode !== "background") await Promise.all([stopProjectTimer(), stopTaskTimer()]);
  return { config, dir, userId, stopProjectTimer, stopTaskTimer };
}

test("manual machines reject automatic rounds while allowing explicit project sync", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected fixture request"));
  const timerSpy = spyOn(globalThis, "setTimeout");
  let owner: Awaited<ReturnType<typeof machine>> | undefined;
  try {
    owner = await machine("user_anna", "Anna");
    timerSpy.mockClear();
    scheduleProjectSync(owner.config, 500);
    scheduleTaskSync(owner.config, 500);
    expect(timerSpy.mock.calls.filter(([, delay]) => delay === 500)).toHaveLength(0);

    const { platform } = fakeFirm();
    const originalList = platform.listProjects;
    let fakeRounds = 0;
    platform.listProjects = async (...args) => { fakeRounds++; return originalList(...args); };
    expect(await runProjectSync(owner.config, { platform })).toEqual({
      ran: true, pushed: 0, pulled: 0, arrived: 0, removed: 0, error: null,
    });
    expect(fakeRounds).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    try {
      if (owner) {
        const stopped = await Promise.allSettled([owner.stopProjectTimer(), owner.stopTaskTimer()]);
        for (const result of stopped) if (result.status === "rejected") throw result.reason;
      }
    } finally {
      timerSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  }
});

async function localProject(config: ServerConfig, name: string): Promise<WorkspaceInfo> {
  const folderPath = join(config.projectsDirectory ?? "", name);
  await mkdir(folderPath, { recursive: true });
  return (await registerLocalProject(config, { folderPath, name, preset: "starter" })).workspace;
}

function projectsOf(config: ServerConfig): WorkspaceInfo[] {
  return config.workspaces.filter((workspace) => workspace.workspaceType === "local");
}

const read = (workspace: WorkspaceInfo, path: string) => readFile(join(workspace.path, path), "utf8").catch(() => null);

async function write(workspace: WorkspaceInfo, path: string, text: string) {
  await mkdir(join(workspace.path, path, ".."), { recursive: true });
  await writeFile(join(workspace.path, path), text);
  // Past the settle time, as a file saved a moment ago would be by the next round.
  const past = new Date(Date.now() - 60_000);
  await utimes(join(workspace.path, path), past, past);
}

/** Every file of a copy past the settle time, as it is a few seconds after it arrived. */
async function settleFiles(workspace: WorkspaceInfo) {
  const past = new Date(Date.now() - 60_000);
  for (const entry of await readdir(workspace.path, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) await utimes(join(entry.parentPath, entry.name), past, past);
  }
}

function settings(overrides: Partial<ProjectSyncSettings> = {}): ProjectSyncSettings {
  return { access: "members", memberIds: [], scope: ALL, ...overrides };
}

async function changePrompt(config: ServerConfig, workspace: WorkspaceInfo, prompt: string) {
  const before = await readProjectDetails(workspace.path);
  const saved = await updateProjectPersonalization(workspace.path, { revision: before.revision, customInstructions: prompt });
  await noteProjectPersonalizationSaved(config, workspace.id, before.personalizationPrompt ?? "", saved.personalizationPrompt ?? "");
}

test("standalone instruction notification queues once after its seed lifetime is released", async () => {
  const dir = await mkdtemp(join(tmpdir(), "standalone-personalization-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const config = { configPath: join(dir, "server.json"), workspaces: [] } as unknown as ServerConfig;
  const seed = acquireRuntimeDbLifetime(config);
  cleanups.push(() => seed.release());
  const store = await projectSyncStore(config);
  store.saveLink({ workspaceId: "standalone", projectId: "project", orgId: ORG, origin: "local", role: "owner", ownerUserId: "owner",
    settings: settings(), confirmed: true, remoteUpdatedAt: null, filesReconciledAt: null, state: "active", allowDeletions: false,
    lastSyncAt: null, lastError: null, report: null });
  await seed.release();
  await noteProjectPersonalizationSaved(config, "standalone", "old", "new instructions");
  await noteProjectPersonalizationSaved(config, "standalone", "new instructions", "new instructions");
  const inspection = acquireRuntimeDbLifetime(config);
  cleanups.push(() => inspection.release());
  const fresh = await projectSyncStore(config);
  expect(fresh.pendingOps("project")).toMatchObject([{ kind: "personalization", prompt: "new instructions" }]);
  expect(fresh.pendingOps("project")).toHaveLength(1);
  const link = fresh.linkByWorkspace("standalone")!;
  fresh.saveLink({ ...link, settings: settings({ scope: { ...ALL, metadata: false } }) });
  await inspection.release();
  await noteProjectPersonalizationSaved(config, "standalone", "new instructions", "private instructions");
  const final = acquireRuntimeDbLifetime(config);
  cleanups.push(() => final.release());
  expect((await projectSyncStore(config)).pendingOps("project")).toHaveLength(1);
});

describe("project sync between computers", () => {
  test("a manual sync consumes its scheduled round without calling the real platform later", async () => {
    const { platform } = fakeFirm();
    const owner = await machine("user_anna", "Anna");
    const akte = await localProject(owner.config, "Manual sync");
    const requests: string[] = [];
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return new Response("unavailable", { status: 503 });
    }, { preconnect: globalThis.fetch.preconnect }));
    try {
      await saveProjectSyncSettings(owner.config, akte, settings({ access: "org" }));
      expect((await runProjectSync(owner.config, { platform })).error).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 650));
      expect(requests.filter((url) => url.includes("/api/projects"))).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("instructions arrive with a shared project, edits return, and clearing reaches both computers", async () => {
    const { platform } = fakeFirm();
    const owner = await machine("user_anna", "Anna");
    const member = await machine("user_ben", "Ben");
    const akte = await localProject(owner.config, "Writing preferences");
    await changePrompt(owner.config, akte, "Use formal English.");
    await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [member.userId] }));
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    const [copy] = projectsOf(member.config);
    expect((await readProjectDetails(copy.path)).personalizationPrompt).toBe("Use formal English.");
    const previous = await readProjectDetails(akte.path);
    await changePrompt(member.config, copy, "Use short paragraphs.");
    await runProjectSync(member.config, { platform });
    await runProjectSync(owner.config, { platform });
    expect((await readProjectDetails(akte.path)).personalizationPrompt).toBe("Use short paragraphs.");
    expect((await readProjectDetails(akte.path)).fields).toEqual(previous.fields);
    await expect(updateProjectPersonalization(akte.path, { revision: previous.revision, customInstructions: "Stale draft" })).rejects.toMatchObject({ code: "project_changed" });
    await changePrompt(owner.config, akte, "");
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    for (const path of [akte.path, copy.path]) expect((await readProjectDetails(path)).personalizationPrompt).toBe("");
  });

  test("a failed upload keeps offline instructions while a newer remote prompt is pulled", async () => {
    const { platform } = fakeFirm();
    const owner = await machine("user_anna", "Anna");
    const member = await machine("user_ben", "Ben");
    const akte = await localProject(owner.config, "Offline preferences");
    await changePrompt(owner.config, akte, "Original instructions");
    await saveProjectSyncSettings(owner.config, akte, settings({ access: "org" }));
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    const [copy] = projectsOf(member.config);
    await changePrompt(owner.config, akte, "Remote edit");
    await runProjectSync(owner.config, { platform });
    await changePrompt(member.config, copy, "Offline edit");
    const offline: ProjectSyncPlatform = { ...platform, patchProject: async (client, id, patch) => {
      if (patch.personalizationPrompt !== undefined) throw new ApiError(503, "temporarily_unavailable", "Try later");
      return platform.patchProject(client, id, patch);
    } };
    await runProjectSync(member.config, { platform: offline });
    const refused: ProjectSyncPlatform = { ...platform, patchProject: async (client, id, patch) => {
      if (patch.personalizationPrompt !== undefined) throw new ApiError(409, "retry_instruction_write", "Try later");
      return platform.patchProject(client, id, patch);
    } };
    expect((await runProjectSync(member.config, { platform: refused })).pulled).toBeGreaterThan(0);
    expect((await readProjectDetails(copy.path)).personalizationPrompt).toBe("Offline edit");
    expect((await projectSyncStore(member.config)).outbox().some((entry) => entry.op.kind === "personalization")).toBe(true);
    await runProjectSync(member.config, { platform });
    await runProjectSync(owner.config, { platform });
    expect((await readProjectDetails(akte.path)).personalizationPrompt).toBe("Offline edit");
  });

  test("Project details scope keeps instructions local when off and publishes them when enabled", async () => {
    const { platform, projects } = fakeFirm();
    const owner = await machine("user_anna", "Anna");
    const member = await machine("user_ben", "Ben");
    const akte = await localProject(owner.config, "Private preferences");
    await changePrompt(owner.config, akte, "Private instructions");
    await saveProjectSyncSettings(owner.config, akte, settings({ access: "org", scope: { ...ALL, metadata: false } }));
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    const [copy] = projectsOf(member.config);
    expect((await readProjectDetails(copy.path)).personalizationPrompt).toBeUndefined();
    await changePrompt(owner.config, akte, "Updated private instructions");
    expect((await projectSyncStore(owner.config)).outbox()).toEqual([]);
    await saveProjectSyncSettings(owner.config, akte, settings({ access: "org" }));
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    expect((await readProjectDetails(copy.path)).personalizationPrompt).toBe("Updated private instructions");
    await saveProjectSyncSettings(owner.config, akte, settings({ access: "org", scope: { ...ALL, metadata: false } }));
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    expect([...projects.values()][0].record.personalizationPrompt).toBeNull();
    expect((await readProjectDetails(copy.path)).personalizationPrompt).toBe("Updated private instructions");
  });

  test("older services retain queued changes and do not erase local instructions", async () => {
    const { platform } = fakeFirm();
    const legacy: ProjectSyncPlatform = { ...platform,
      createProject: async (client, input) => { const result = await platform.createProject(client, input); delete result.personalizationPrompt; return result; },
      patchProject: async (client, id, patch) => { const result = await platform.patchProject(client, id, patch); if (result.project) delete result.project.personalizationPrompt; return result; },
      listProjects: async (client, params) => { const result = await platform.listProjects(client, params); for (const project of result.projects) delete project.personalizationPrompt; return result; },
    };
    const owner = await machine("user_anna", "Anna");
    const akte = await localProject(owner.config, "Legacy service");
    await saveProjectSyncSettings(owner.config, akte, settings({ access: "org" }));
    await runProjectSync(owner.config, { platform: legacy });
    await changePrompt(owner.config, akte, "Keep these instructions");
    await runProjectSync(owner.config, { platform: legacy });
    expect((await readProjectDetails(akte.path)).personalizationPrompt).toBe("Keep these instructions");
    const pending = (await projectSyncStore(owner.config)).outbox();
    expect(pending).toHaveLength(1);
    expect(pending[0].op.kind).toBe("personalization");
    expect((await projectSyncStatus(owner.config, akte)).error).toContain("team service needs an update");
    await runProjectSync(owner.config, { platform });
    expect((await projectSyncStore(owner.config)).outbox()).toEqual([]);
    expect((await projectSyncStatus(owner.config, akte)).error).toBeNull();
  });

  test("an existing shared project's saved local instructions survive service rollout and are published", async () => {
    const { platform, projects } = fakeFirm();
    const owner = await machine("user_anna", "Anna");
    const member = await machine("user_ben", "Ben");
    const akte = await localProject(owner.config, "Existing project");
    await saveProjectSyncSettings(owner.config, akte, settings({ access: "org" }));
    await runProjectSync(owner.config, { platform });
    const stored = [...projects.values()][0];
    stored.record.personalizationPrompt = null;
    stored.record.updatedAt = new Date(Date.parse(stored.record.updatedAt) + 1000).toISOString();
    const details = await readProjectDetails(akte.path);
    await updateProjectPersonalization(akte.path, { revision: details.revision, customInstructions: "Previously saved instructions" });
    await runProjectSync(owner.config, { platform });
    expect((await readProjectDetails(akte.path)).personalizationPrompt).toBe("Previously saved instructions");
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    expect((await readProjectDetails(projectsOf(member.config)[0].path)).personalizationPrompt).toBe("Previously saved instructions");
  });

  test("a shared project and its documents reach a named member, and edits come back", async () => {
    const { platform } = fakeFirm();
    const owner = await machine("user_anna", "Anna");
    const member = await machine("user_ben", "Ben");
    const outsider = await machine("user_cleo", "Cleo");

    const akte = await localProject(owner.config, "Müller ./. Schmidt");
    await write(akte, "Schriftsätze/Klage.pdf", "klage v1");
    await write(akte, "Notes/Termin.md", "# Termin");
    await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [member.userId] }));
    await runProjectSync(owner.config, { platform });

    await runProjectSync(member.config, { platform });
    const [copy] = projectsOf(member.config);
    expect(copy?.name).toBe("Müller ./. Schmidt");
    expect(await read(copy, "Schriftsätze/Klage.pdf")).toBe("klage v1");
    expect(await read(copy, "Notes/Termin.md")).toBe("# Termin");
    // The copy knows which Akte it is, so it is never taken for a new one.
    expect((await readProjectDetails(copy.path)).syncProjectId).toBe((await readProjectDetails(akte.path)).syncProjectId);
    expect((await projectSyncStatus(member.config, copy)).role).toBe("member");
    expect((await projectSyncOverview(owner.config)).roles?.[akte.id]).toBe("owner");
    expect((await projectSyncOverview(member.config)).roles?.[copy.id]).toBe("member");

    await runProjectSync(outsider.config, { platform });
    expect(projectsOf(outsider.config)).toEqual([]);

    await write(copy, "Schriftsätze/Klage.pdf", "klage v2 (Ben)");
    await runProjectSync(member.config, { platform });
    await runProjectSync(owner.config, { platform });
    expect(await read(akte, "Schriftsätze/Klage.pdf")).toBe("klage v2 (Ben)");
    expect((await projectSyncStatus(owner.config, akte)).state).toBe("synced");
  });

  test("a round on a server that does not list a synced project leaves it synced", async () => {
    const { platform } = fakeFirm();
    const owner = await machine("user_anna", "Anna");
    const akte = await localProject(owner.config, "Akte");
    await saveProjectSyncSettings(owner.config, akte, settings({ access: "org" }));
    await runProjectSync(owner.config, { platform });

    // The same runtime DB and sign-in with another project list, as a test's server had.
    await runProjectSync({ ...owner.config, workspaces: [] }, { platform });
    expect((await projectSyncStatus(owner.config, akte)).mode).toBe("synced");
  });

  test("a note edited on both computers in different places ends up with both edits, and no copy", async () => {
    const { platform } = fakeFirm();
    const owner = await machine("user_anna", "Anna");
    const member = await machine("user_ben", "Ben");
    const akte = await localProject(owner.config, "Akte");
    const note = "Notes/Termin-ee006b29.md";
    await write(akte, note, "# Termin\n\nDer Mandant kommt am Montag um zehn Uhr.\n");
    await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [member.userId] }));
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    const [copy] = projectsOf(member.config);

    await write(akte, note, "# Termin\n\nDer Mandant kommt am Dienstag um zehn Uhr.\n");
    await write(copy, note, "# Termin\n\nDer Mandant kommt am Montag um zehn Uhr.\n\nVollmacht mitbringen.\n");
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    await runProjectSync(owner.config, { platform });

    const both = "# Termin\n\nDer Mandant kommt am Dienstag um zehn Uhr.\n\nVollmacht mitbringen.\n";
    expect(await read(akte, note)).toBe(both);
    expect(await read(copy, note)).toBe(both);
    expect((await projectSyncStatus(member.config, copy)).conflicts).toEqual([]);
  });

  test("a Tabular Review goes with the documents, and a colleague's answers come back", async () => {
    const { platform } = fakeFirm();
    const owner = await machine("user_anna", "Anna");
    const member = await machine("user_ben", "Ben");
    const akte = await localProject(owner.config, "Akte");
    await write(akte, "Vertrag.pdf", "vertrag");
    const reviews = new ReviewStore(akte.path);
    const column = { key: "assign", label: "Abtretung", question: "Ist eine Abtretung erlaubt?", kind: "yes_no" as const, options: [], hint: "" };
    const document = { id: "doc-1", path: "Vertrag.pdf", name: "Vertrag.pdf", sourceHash: null, status: "pending" as const, completedPages: 0, pageCount: 0, error: null };
    const review = await reviews.create({
      id: "5c0ffee0-1111-4222-8333-944445555666", name: "Prüfung", sessionId: "ses_anna", revision: 0, createdAt: 1, updatedAt: 1,
      settings: { mode: "llm", jev: null, llm: { providerId: "firm", model: "chat" } }, columns: [column], documents: [document],
      cells: [{ documentId: "doc-1", columnKey: "assign", status: "pending", result: null, error: null }], status: "draft", runId: null, error: null,
    });
    await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [member.userId] }));
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });

    const [copy] = projectsOf(member.config);
    const arrived = await new ReviewStore(copy.path).read(review.id);
    expect(arrived).toMatchObject({ name: "Prüfung", sessionId: null, documents: [{ path: "Vertrag.pdf" }] });

    await new ReviewStore(copy.path).update(review.id, (current) => {
      current.name = "Prüfung (Ben)";
    });
    await runProjectSync(member.config, { platform });
    await runProjectSync(owner.config, { platform });
    expect(await reviews.read(review.id)).toMatchObject({ name: "Prüfung (Ben)", sessionId: "ses_anna" });
    expect((await projectSyncStatus(owner.config, akte)).state).toBe("synced");

    // Without reviews in what is shared, they stay on each computer.
    await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [member.userId], scope: { ...ALL, reviews: false } }));
    await reviews.update(review.id, (current) => {
      current.name = "Nur bei Anna";
    });
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    expect((await new ReviewStore(copy.path).read(review.id)).name).toBe("Prüfung (Ben)");
  });

  test("with reviews shared and documents not, only the documents a review reviews go with it", async () => {
    const { platform } = fakeFirm();
    const owner = await machine("user_anna", "Anna");
    const member = await machine("user_ben", "Ben");
    const akte = await localProject(owner.config, "Akte");
    await write(akte, "Verträge/Kaufvertrag.pdf", "kaufvertrag");
    await write(akte, "Verträge/Entwurf.pdf", "entwurf");
    await write(akte, "Notes/Termin.md", "# Termin");
    const column = { key: "assign", label: "Abtretung", question: "Ist eine Abtretung erlaubt?", kind: "yes_no" as const, options: [], hint: "" };
    const document = { id: "doc-1", path: "Verträge/Kaufvertrag.pdf", name: "Kaufvertrag.pdf", sourceHash: null, status: "pending" as const, completedPages: 0, pageCount: 0, error: null };
    const review = await new ReviewStore(akte.path).create({
      id: "5c0ffee0-1111-4222-8333-944445555777", name: "Prüfung", sessionId: null, revision: 0, createdAt: 1, updatedAt: 1,
      settings: { mode: "llm", jev: null, llm: { providerId: "firm", model: "chat" } }, columns: [column], documents: [document],
      cells: [{ documentId: "doc-1", columnKey: "assign", status: "pending", result: null, error: null }], status: "draft", runId: null, error: null,
    });
    await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [member.userId], scope: { ...ALL, documents: false, notes: false } }));
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });

    const [copy] = projectsOf(member.config);
    expect((await new ReviewStore(copy.path).read(review.id)).documents[0].path).toBe("Verträge/Kaufvertrag.pdf");
    expect(await read(copy, "Verträge/Kaufvertrag.pdf")).toBe("kaufvertrag");
    expect(await read(copy, "Verträge/Entwurf.pdf")).toBeNull();
    expect(await read(copy, "Notes/Termin.md")).toBeNull();
    expect((await projectSyncStatus(owner.config, akte)).state).toBe("synced");
  });

  test("renames and project details reach the other computer; each detail keeps the newer edit", async () => {
    const { platform } = fakeFirm();
    const owner = await machine("user_anna", "Anna");
    const member = await machine("user_ben", "Ben");
    const akte = await localProject(owner.config, "Akte");
    const client: ProjectField = { id: "client", label: "Mandant", type: "text", value: "Müller GmbH" };
    await updateProjectDetails(akte.path, { revision: 0, fields: [client] });
    await saveProjectSyncSettings(owner.config, akte, settings({ access: "org" }));
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    const [copy] = projectsOf(member.config);
    expect((await readProjectDetails(copy.path)).fields).toEqual([client]);

    // Ben renames it and sets the status; Anna changes the client meanwhile.
    await noteProjectRenamed(member.config, copy.id, "Müller GmbH – Kündigung");
    const status: ProjectField = { id: "status", label: "Sachstand", type: "text", value: "Offen" };
    const before = (await readProjectDetails(copy.path)).fields;
    const saved = await updateProjectDetails(copy.path, { revision: (await readProjectDetails(copy.path)).revision, fields: [...before, status] });
    await noteProjectDetailsSaved(member.config, copy.id, before, saved.fields);
    const ownerBefore = (await readProjectDetails(akte.path)).fields;
    const renamedClient = { ...client, value: "Müller AG" };
    const ownerSaved = await updateProjectDetails(akte.path, { revision: (await readProjectDetails(akte.path)).revision, fields: [renamedClient] });
    await noteProjectDetailsSaved(owner.config, akte.id, ownerBefore, ownerSaved.fields);

    await runProjectSync(member.config, { platform });
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });

    expect(projectsOf(owner.config)[0]?.name).toBe("Müller GmbH – Kündigung");
    for (const path of [akte.path, copy.path]) {
      expect((await readProjectDetails(path)).fields).toEqual([renamedClient, status]);
    }
  });

  test("keeps both versions when two members edit the same document", async () => {
    const { platform } = fakeFirm();
    const owner = await machine("user_anna", "Anna");
    const member = await machine("user_ben", "Ben");
    const akte = await localProject(owner.config, "Akte");
    await write(akte, "Vertrag.docx", "base");
    await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [member.userId] }));
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    const [copy] = projectsOf(member.config);

    await write(akte, "Vertrag.docx", "Anna's edit");
    await write(copy, "Vertrag.docx", "Ben's edit");
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    await runProjectSync(owner.config, { platform });

    // What shows Ben's project reloads: its files changed on his computer.
    expect((await projectSyncOverview(member.config)).contents[copy.id]).toBeGreaterThan(0);
    const status = await projectSyncStatus(member.config, copy);
    // Not a state of the project: Home asks which version stays.
    expect(status.state).not.toBe("error");
    expect(status.conflicts).toHaveLength(1);
    const copyName = status.conflicts[0]?.copyPath ?? "";
    expect(copyName).toMatch(/^Vertrag \(Ben, \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\)\.docx$/);
    for (const workspace of [akte, copy]) {
      expect(await read(workspace, "Vertrag.docx")).toBe("Anna's edit");
      expect(await read(workspace, copyName)).toBe("Ben's edit");
    }
    await resolveProjectSync(member.config, copy, { action: "dismiss_conflict", copyPath: copyName });
    expect((await projectSyncStatus(member.config, copy)).conflicts).toEqual([]);
  });

  test("after a conflict, keeping mine puts it back for everyone, and taking theirs drops mine, both into the sync trash", async () => {
    const { platform } = fakeFirm();
    const owner = await machine("user_anna", "Anna");
    const member = await machine("user_ben", "Ben");
    const akte = await localProject(owner.config, "Akte");
    await write(akte, "Vertrag.docx", "base");
    await write(akte, "Vollmacht.docx", "base");
    await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [member.userId] }));
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    const [copy] = projectsOf(member.config);

    for (const name of ["Vertrag.docx", "Vollmacht.docx"]) {
      await write(akte, name, "Anna's edit");
      await write(copy, name, "Ben's edit");
    }
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    const conflicts = (await projectSyncStatus(member.config, copy)).conflicts;
    const copyOf = (path: string) => conflicts.find((conflict) => conflict.path === path)?.copyPath ?? "";

    await resolveProjectSync(member.config, copy, { action: "keep_mine", copyPath: copyOf("Vertrag.docx") });
    await resolveProjectSync(member.config, copy, { action: "use_theirs", copyPath: copyOf("Vollmacht.docx") });
    expect((await projectSyncStatus(member.config, copy)).conflicts).toEqual([]);
    expect(await read(copy, "Vertrag.docx")).toBe("Ben's edit");
    expect(await read(copy, "Vollmacht.docx")).toBe("Anna's edit");
    expect(await read(copy, copyOf("Vertrag.docx"))).toBeNull();
    expect(await read(copy, copyOf("Vollmacht.docx"))).toBeNull();
    expect(await readdir(join(copy.path, ".legalwork", "sync-trash"))).not.toEqual([]);

    // The next rounds take the choice to the firm and to Anna, copies gone there too
    // (once the restored file has settled, as every file saved a moment ago waits).
    const past = new Date(Date.now() - 60_000);
    await utimes(join(copy.path, "Vertrag.docx"), past, past);
    await runProjectSync(member.config, { platform });
    await runProjectSync(owner.config, { platform });
    expect(await read(akte, "Vertrag.docx")).toBe("Ben's edit");
    expect(await read(akte, "Vollmacht.docx")).toBe("Anna's edit");
    expect(await read(akte, copyOf("Vertrag.docx"))).toBeNull();
    expect(await read(akte, copyOf("Vollmacht.docx"))).toBeNull();
    await expect(resolveProjectSync(member.config, copy, { action: "keep_mine", copyPath: "../Vertrag.docx" })).rejects.toMatchObject({ code: "project_conflict_not_found" });
  });

  test("a member taken off the project loses the copy — or decides, when changes made there had not reached the firm", async () => {
    const observer = createProjectSyncFirstFailureTiming({
      env: {
        LAWOSS_PROJECT_SYNC_TEST_DIAGNOSTICS: process.env.LAWOSS_PROJECT_SYNC_TEST_DIAGNOSTICS,
        CI: process.env.CI,
        GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
      },
      now: () => performance.now(),
      write: (frame) => { console.error(frame.trimEnd()); },
    });
    activeFirstFailureTiming = observer;
    try {
      const { platform } = fakeFirm();
      observer.enter(1);
      const owner = await machine("user_anna", "Anna");
      observer.done(1);
      observer.enter(2);
      const member = await machine("user_ben", "Ben");
      observer.done(2);
      observer.enter(3);
      const akte = await localProject(owner.config, "Akte");
      observer.done(3);
      observer.enter(4);
      await write(akte, "a.txt", "a");
      observer.done(4);
      observer.enter(5);
      await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [member.userId] }), observer.settingsCheckpoint);
      observer.done(5);
      observer.enter(6);
      await runProjectSync(owner.config, { platform });
      observer.done(6);
      observer.enter(7);
      await runProjectSync(member.config, { platform });
      observer.done(7);
      const [copy] = projectsOf(member.config);

      // Offline edit on Ben's computer, then Anna takes him off the Akte.
      observer.enter(8);
      await write(copy, "b.txt", "Ben's note");
      observer.done(8);
      observer.enter(9);
      await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [] }));
      observer.done(9);
      observer.enter(10);
      await runProjectSync(owner.config, { platform });
      observer.done(10);
      observer.enter(11);
      const pull = await runProjectSync(member.config, { platform: { ...platform, storage: () => {
        throw new ApiError(502, "intake_unreachable", "offline for documents");
      } } });
      observer.done(11);
      observer.enter(12);
      expect(pull.removed).toBe(0);
      observer.done(12);
      observer.enter(13);
      expect(await projectSyncStatus(member.config, copy)).toMatchObject({ state: "revoked", pendingChanges: 1 });
      observer.done(13);
      observer.enter(14);
      expect(await read(copy, "b.txt")).toBe("Ben's note");
      observer.done(14);

      // Given access again, the held-back copy syncs again, changes included.
      observer.enter(15);
      await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [member.userId] }));
      observer.done(15);
      observer.enter(16);
      await runProjectSync(owner.config, { platform });
      observer.done(16);
      observer.enter(17);
      await settleFiles(copy);
      observer.done(17);
      observer.enter(18);
      await runProjectSync(member.config, { platform });
      observer.done(18);
      observer.enter(19);
      await runProjectSync(owner.config, { platform });
      observer.done(19);
      observer.enter(20);
      expect((await projectSyncStatus(member.config, copy)).state).toBe("synced");
      observer.done(20);
      observer.enter(21);
      expect(await read(akte, "b.txt")).toBe("Ben's note");
      observer.done(21);

      observer.enter(22);
      await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [] }));
      observer.done(22);
      observer.enter(23);
      await runProjectSync(owner.config, { platform });
      observer.done(23);
      observer.enter(24);
      await write(copy, "c.txt", "another offline note");
      observer.done(24);
      observer.enter(25);
      await runProjectSync(member.config, { platform: { ...platform, storage: () => {
        throw new ApiError(502, "intake_unreachable", "offline for documents");
      } } });
      observer.done(25);
      observer.enter(26);
      expect((await projectSyncStatus(member.config, copy)).state).toBe("revoked");
      observer.done(26);
      observer.enter(27);
      await resolveProjectSync(member.config, copy, { action: "keep_local" });
      observer.done(27);
      observer.enter(28);
      expect((await projectSyncStatus(member.config, copy)).mode).toBe("local");
      observer.done(28);
      observer.enter(29);
      expect(await read(copy, "c.txt")).toBe("another offline note");
      observer.done(29);

      // Without such changes the copy simply goes.
      observer.enter(30);
      await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [member.userId] }));
      observer.done(30);
      observer.enter(31);
      await runProjectSync(owner.config, { platform });
      observer.done(31);
      observer.enter(32);
      await runProjectSync(member.config, { platform });
      observer.done(32);
      const second = projectsOf(member.config).find((workspace) => workspace.id !== copy.id);
      observer.enter(33);
      expect(second).toBeDefined();
      observer.done(33);
      observer.enter(34);
      await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [] }));
      observer.done(34);
      observer.enter(35);
      await runProjectSync(owner.config, { platform });
      observer.done(35);
      observer.enter(36);
      await runProjectSync(member.config, { platform });
      observer.done(36);
      observer.enter(37);
      expect(projectsOf(member.config).map((workspace) => workspace.id)).toEqual([copy.id]);
      observer.done(37);
      observer.enter(38);
      expect(await readdir(second?.path ?? "").catch(() => null)).toBeNull();
      observer.done(38);
      // The app's own list forgets it too.
      observer.enter(39);
      expect((await projectSyncOverview(member.config)).removed).toEqual([second?.id ?? ""]);
      observer.done(39);
      observer.complete();
    } catch (error) {
      observer.failed();
      throw error;
    } finally {
      observer.settled();
    }
  });

  test("a file whose time alone moved is no change: without real changes, the copy goes when access ends", async () => {
    const { platform } = fakeFirm();
    const owner = await machine("user_anna", "Anna");
    const member = await machine("user_ben", "Ben");
    const akte = await localProject(owner.config, "Akte");
    await write(akte, "a.txt", "a");
    await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [member.userId] }));
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    const [copy] = projectsOf(member.config);
    const touched = new Date(Date.now() - 30_000);
    await utimes(join(copy.path, "a.txt"), touched, touched);

    await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [] }));
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    expect(projectsOf(member.config)).toEqual([]);
  });

  test("stopping sync keeps the owner's project local and takes every copy away", async () => {
    const { platform } = fakeFirm();
    const owner = await machine("user_anna", "Anna");
    const member = await machine("user_ben", "Ben");
    const akte = await localProject(owner.config, "Akte");
    await write(akte, "a.txt", "a");
    await saveProjectSyncSettings(owner.config, akte, settings({ access: "org" }));
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    expect(projectsOf(member.config)).toHaveLength(1);

    await stopProjectSync(owner.config, akte);
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });

    expect(projectsOf(member.config)).toEqual([]);
    expect((await projectSyncOverview(member.config)).removed).toHaveLength(1);
    expect((await projectSyncOverview(owner.config)).removed).toEqual([]);
    expect(await read(akte, "a.txt")).toBe("a");
    expect((await projectSyncStatus(owner.config, akte)).mode).toBe("local");
    expect((await readProjectDetails(akte.path)).syncProjectId).toBeUndefined();
  });

  test("shared again after stopping, it is the same project: a copy held back takes it up again, with its changes and nothing lost", async () => {
    const { platform, projects } = fakeFirm();
    const owner = await machine("user_anna", "Anna");
    const member = await machine("user_ben", "Ben");
    const akte = await localProject(owner.config, "Akte");
    await write(akte, "a.txt", "a");
    await saveProjectSyncSettings(owner.config, akte, settings({ access: "org" }));
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    const [copy] = projectsOf(member.config);
    const firstId = (await readProjectDetails(akte.path)).syncProjectId;

    // Ben writes a note that has not reached the firm when Anna stops: his copy is held back.
    await write(copy, "Notes/Ben.md", "Ben's note");
    await stopProjectSync(owner.config, akte);
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform: { ...platform, storage: () => {
      throw new ApiError(502, "intake_unreachable", "offline for documents");
    } } });
    expect((await projectSyncStatus(member.config, copy)).state).toBe("revoked");

    await saveProjectSyncSettings(owner.config, akte, settings({ access: "org" }));
    await runProjectSync(owner.config, { platform });
    expect((await readProjectDetails(akte.path)).syncProjectId).toBe(firstId);
    expect(projects.size).toBe(1);

    await settleFiles(copy);
    await runProjectSync(member.config, { platform });
    await runProjectSync(owner.config, { platform });
    expect(projectsOf(member.config).map((workspace) => workspace.id)).toEqual([copy.id]);
    expect((await projectSyncStatus(member.config, copy)).state).toBe("synced");
    expect((await projectSyncStatus(member.config, copy)).conflicts).toEqual([]);
    expect(await read(copy, "a.txt")).toBe("a");
    expect(await read(akte, "Notes/Ben.md")).toBe("Ben's note");
  });

  test("an arrival interrupted after its folder was made is picked up again, not duplicated", async () => {
    const { platform } = fakeFirm();
    const owner = await machine("user_anna", "Anna");
    const member = await machine("user_ben", "Ben");
    const akte = await localProject(owner.config, "Akte");
    await write(akte, "a.txt", "a");
    await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [member.userId] }));
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    const [copy] = projectsOf(member.config);

    // Ben's computer loses its registry and sync state (a reinstall), but the folder stays.
    const fresh = { ...member.config, workspaces: [], authorizedRoots: [], configPath: join(member.dir, "fresh", "server.json") };
    await writeEigenweltConnection(fresh, {
      platformToken: "tok_user_ben",
      account: { userId: "user_ben", userName: "Ben", userEmail: "ben@kanzlei.test", orgId: ORG, orgName: "Kanzlei" },
    });
    await runProjectSync(fresh, { platform });

    expect(projectsOf(fresh).map((workspace) => workspace.path)).toEqual([copy.path]);
    expect(await readdir(member.config.projectsDirectory ?? "")).toEqual(["Akte"]);
  });

  /** One folder both computers see (a shared drive), each has as its own project; the owner shares it. */
  async function sameFolderOnBoth() {
    const { platform } = fakeFirm();
    const owner = await machine("user_anna", "Anna");
    const member = await machine("user_ben", "Ben");
    const folderPath = join(owner.dir, "Laufwerk", "Akte");
    await mkdir(folderPath, { recursive: true });
    const akte = (await registerLocalProject(owner.config, { folderPath, name: "Akte", preset: "starter" })).workspace;
    const own = (await registerLocalProject(member.config, { folderPath, name: "Akte", preset: "starter" })).workspace;
    await write(akte, "a.txt", "a");
    const tasks = await taskStore(member.config);
    const task = tasks.createTask({ title: "Privat", projectId: own.id }, { userId: "user_ben", name: "Ben", email: null });
    await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [member.userId] }));
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    const projectId = (await readProjectDetails(folderPath)).syncProjectId;
    return { platform, owner, member, akte, own, tasks, task, folderPath, projectId };
  }

  test("a member's own folder that already is the shared project is not taken over unasked; kept apart, the project gets its own", async () => {
    const { platform, member, own, tasks, task, folderPath } = await sameFolderOnBoth();

    // Nothing is taken over and nothing of Ben's is sent: he is asked.
    expect(await projectSyncStatus(member.config, own)).toMatchObject({
      mode: "local",
      state: "offered",
      offer: { name: "Akte", ownerUserId: "user_anna" },
    });
    expect((await projectSyncOverview(member.config)).states[own.id]).toBe("offered");
    expect((await projectSyncOverview(member.config)).roles?.[own.id]).toBeUndefined();
    expect(projectsOf(member.config).map((workspace) => workspace.id)).toEqual([own.id]);
    expect(tasks.listOutbox().filter((entry) => entry.taskId === task.id)).toEqual([]);
    await expect(saveProjectSyncSettings(member.config, own, settings())).rejects.toMatchObject({ code: "project_sync_offer_pending" });

    await resolveProjectSync(member.config, own, { action: "keep_apart" });
    await runProjectSync(member.config, { platform });
    const copy = projectsOf(member.config).find((workspace) => workspace.id !== own.id);
    expect(copy?.path).toBeDefined();
    expect(copy?.path).not.toBe(folderPath);
    expect(copy ? await read(copy, "a.txt") : null).toBe("a");
    expect(await projectSyncStatus(member.config, own)).toMatchObject({ mode: "local", state: "local", offer: null });
    expect(tasks.listOutbox().filter((entry) => entry.taskId === task.id)).toEqual([]);
  });

  test("used as the member's copy, their own folder stays theirs when they are taken off or leave", async () => {
    const { platform, owner, member, akte, own, folderPath, projectId } = await sameFolderOnBoth();
    await resolveProjectSync(member.config, own, { action: "use_folder" });
    await runProjectSync(member.config, { platform });
    expect(await projectSyncStatus(member.config, own)).toMatchObject({ mode: "synced", role: "member", ownFolder: true });
    expect((await projectSyncOverview(member.config)).roles?.[own.id]).toBe("member");
    expect(projectsOf(member.config).map((workspace) => workspace.id)).toEqual([own.id]);

    // Taken off: the project stays Ben's own, and Anna's id in the shared folder is left alone.
    await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [] }));
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    expect(projectsOf(member.config).map((workspace) => workspace.id)).toEqual([own.id]);
    expect((await projectSyncStatus(member.config, own)).mode).toBe("local");
    expect(await read(own, "a.txt")).toBe("a");
    expect((await readProjectDetails(folderPath)).syncProjectId).toBe(projectId);

    // Given access again, he chose this folder before; leaving keeps it too.
    await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [member.userId] }));
    await runProjectSync(owner.config, { platform });
    await runProjectSync(member.config, { platform });
    expect((await projectSyncStatus(member.config, own)).mode).toBe("synced");
    await resolveProjectSync(member.config, own, { action: "remove", force: true });
    expect(projectsOf(member.config).map((workspace) => workspace.id)).toEqual([own.id]);
    expect(await read(own, "a.txt")).toBe("a");
    await runProjectSync(member.config, { platform });
    expect((await projectSyncStatus(member.config, own)).state).toBe("local");
  });

  test("recordings linked to the project reach colleagues when recordings are in the scope", async () => {
    const { platform } = fakeFirm();
    const owner = await machine("user_anna", "Anna");
    const member = await machine("user_ben", "Ben");
    const akte = await localProject(owner.config, "Akte");
    const exported: string[] = [];
    const idle = { available: false, recordingActive: false, liveTranscriptActive: false, fileName: null, error: null };
    const recorder: RecorderBridge = {
      listProjectRecordings: async (projectId) =>
        projectId === akte.id
          ? [
              { id: "rec_done", title: "Mandantengespräch", durationMs: 1000, status: "complete", segmentCount: 1 },
              { id: "rec_live", title: "Läuft noch", durationMs: 0, status: "recording", segmentCount: 0 },
            ]
          : [],
      exportProjectRecording: async (_projectId, id, root) => {
        exported.push(id);
        await mkdir(join(root, "recordings", "2026-09-25-mandantengesprach"), { recursive: true });
        await writeFile(join(root, "recordings", "2026-09-25-mandantengesprach", "transcript.md"), "# Mandantengespräch");
        const past = new Date(Date.now() - 60_000);
        await utimes(join(root, "recordings", "2026-09-25-mandantengesprach", "transcript.md"), past, past);
        return true;
      },
      status: () => idle,
      setLiveTranscript: () => idle,
    };
    owner.config.recorder = recorder;

    await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [member.userId], scope: { ...ALL, recordings: false } }));
    await runProjectSync(owner.config, { platform });
    expect(exported).toEqual([]);

    await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [member.userId], scope: { ...ALL, recordings: true } }));
    await runProjectSync(owner.config, { platform });
    await runProjectSync(owner.config, { platform });
    // Only the finished recording, and only once.
    expect(exported).toEqual(["rec_done"]);

    await runProjectSync(member.config, { platform });
    const [copy] = projectsOf(member.config);
    expect(await read(copy, "recordings/2026-09-25-mandantengesprach/transcript.md")).toBe("# Mandantengespräch");
  });

  test("tasks of a local project stay on this computer; turning sync on sends them", async () => {
    const { platform } = fakeFirm();
    const owner = await machine("user_anna", "Anna");
    const akte = await localProject(owner.config, "Akte");
    const tasks = await taskStore(owner.config);
    const actor = { userId: "user_anna", name: "Anna", email: null };
    const task = tasks.createTask({ title: "Frist prüfen", projectId: akte.id }, actor);
    expect(tasks.listOutbox().filter((entry) => entry.taskId === task.id)).toEqual([]);

    await saveProjectSyncSettings(owner.config, akte, settings());
    expect(tasks.listOutbox().filter((entry) => entry.taskId === task.id).map((entry) => entry.op.kind)).toEqual(["create"]);

    // Taking tasks out of the scope keeps them here again.
    await runProjectSync(owner.config, { platform });
    await saveProjectSyncSettings(owner.config, akte, settings({ scope: { ...ALL, tasks: false } }));
    expect(tasks.getTask(task.id)?.sync.orgId).toBeNull();
    tasks.patchTask(task.id, { title: "Frist prüfen (lokal)" }, actor);
    expect(tasks.listOutbox().filter((entry) => entry.taskId === task.id)).toEqual([]);
  });
});

describe("diffFields", () => {
  const a: ProjectField = { id: "a", label: "A", type: "text", value: "1" };
  const b: ProjectField = { id: "b", label: "B", type: "text", value: null };

  test("names changed, added and removed details, and the order only when it moved", () => {
    expect(diffFields([a, b], [a, { ...b, value: "2" }])).toEqual({ changes: [{ id: "b", field: { ...b, value: "2" } }], order: null });
    expect(diffFields([a], [a, b])).toEqual({ changes: [{ id: "b", field: b }], order: ["a", "b"] });
    expect(diffFields([a, b], [b])).toEqual({ changes: [{ id: "a", field: null }], order: null });
    expect(diffFields([a, b], [b, a])).toEqual({ changes: [], order: ["b", "a"] });
  });
});

test("team project configuration shares folder references and setup status even with document sync disabled", async () => {
  const { platform } = fakeFirm();
  const owner = await machine("user_anna", "Anna");
  const member = await machine("user_ben", "Ben");
  const akte = await localProject(owner.config, "Remote matter");
  const remote = { version: 1 as const, initialization: "ready" as const, folders: [{ id: crypto.randomUUID(), connectionId: `team:${crypto.randomUUID()}`, connectionName: "Team drive", organizationId: ORG, connectionFingerprint: "a".repeat(64), folder: { id: "100", namespace: "box", path: "Matter", name: "Matter" } }] };
  await updateProjectRemote(akte.path, remote);
  await saveProjectSyncSettings(owner.config, akte, settings({ memberIds: [member.userId], scope: { documents: false, notes: false, tasks: false, recordings: false, metadata: false, reviews: false } }));
  await runProjectSync(owner.config, { platform });
  await runProjectSync(member.config, { platform });
  const [copy] = projectsOf(member.config);
  expect((await readProjectDetails(copy.path)).remote).toEqual(remote);
  expect((await readProjectDetails(copy.path)).syncProjectId).toBe((await readProjectDetails(akte.path)).syncProjectId);
  await updateProjectRemote(copy.path, { ...remote, folders: [] });
  await noteProjectFoldersChanged(member.config, copy.id);
  await runProjectSync(member.config, { platform });
  await runProjectSync(owner.config, { platform });
  expect((await readProjectDetails(akte.path)).remote?.folders).toEqual([]);
  expect((await readProjectDetails(akte.path)).remote).not.toHaveProperty("context");
});

test("stopping project sync awaits the already running round before releasing its producers", async () => {
  const { startProjectSyncTimer } = await import("./project-sync.js");
  const { platform } = fakeFirm(); const owner = await machine("user_anna", "Anna", { syncMode: "background" });
  let enter!: () => void, resume!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const barrier = new Promise<void>(resolve => { resume = resolve; });
  const originalList = platform.listProjects;
  platform.listProjects = async (...args) => { enter(); await barrier; return originalList(...args); };
  const stop = startProjectSyncTimer(owner.config, 60_000, 60_000);
  const round = runProjectSync(owner.config, { platform }); await entered;
  let stopped = false; const closing = Promise.resolve(stop()).then(() => { stopped = true; });
  try { await new Promise(resolve => setTimeout(resolve, 10)); expect(stopped).toBe(false); }
  finally { resume(); await round; await closing; }
  expect((await projectSyncOverview(owner.config)).connected).toBeDefined();
});


test("a shared project watcher dispatches to the surviving timer owner", async () => {
  const owner = await machine("user_anna", "Anna", { syncMode: "background" });
  const { platform } = fakeFirm();
  const workspace = await localProject(owner.config, "Retained watcher");
  await saveProjectSyncSettings(owner.config, workspace, settings());
  await runProjectSync(owner.config, { platform });
  let calls = 0;
  const http = createServer((request, response) => {
    calls++; request.resume(); response.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ code: "unavailable" }));
  });
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>(resolve => http.close(() => resolve())));
  const address = http.address(); if (!address || typeof address === "string") throw new Error("platform failed to bind");
  const previousPlatform = process.env.EIGENWELT_PLATFORM_URL;
  process.env.EIGENWELT_PLATFORM_URL = `http://127.0.0.1:${address.port}`;
  cleanups.push(async () => { if (previousPlatform === undefined) delete process.env.EIGENWELT_PLATFORM_URL; else process.env.EIGENWELT_PLATFORM_URL = previousPlatform; });
  await writeEigenweltConnection(owner.config, { platformURL: process.env.EIGENWELT_PLATFORM_URL });
  const secondConfig = { ...owner.config };
  const stopSecond = startProjectSyncTimer(secondConfig, 60_000, 60_000); cleanups.push(stopSecond);
  await owner.stopProjectTimer();
  await write(workspace, "surviving-owner.txt", "watcher still dispatches");
  const deadline = Date.now() + 4_500;
  while (!calls && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  expect(calls).toBeGreaterThan(0);
  await stopSecond();
}, 10_000);
