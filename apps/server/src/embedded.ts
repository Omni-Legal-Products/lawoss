/**
 * Single entry point for embedding the LegalWork server in-process.
 *
 * Handles config resolution, managed OpenCode spawn, and server start
 * in one call -- mirrors what cli.ts does but returns a handle instead
 * of owning the process lifecycle.
 */
import { mkdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { resolveServerConfig, type CliArgs } from "./config.js";
import { createManagedOpencodeServer, type ManagedOpencodeServer, type OpencodeExecutionSnapshot } from "./managed-opencode.js";
import { startServer, syncAllWorkspacesRuntimeMcpToEngine } from "./server.js";
import { ensureWorkspaceFiles, ensureWorkspaceFilesForBootstrap } from "./workspace-init.js";
import { externalOpencodeConfigDir, workspaceAppFilesRoot, usesExternalWorkspaceAppFiles } from "./lawoss/workspace-app-files.js";
import { globalSkillsDir } from "./workspace-files.js";
import { ensureBundledWorkflows } from "./bundled-workflows.js";
import { retireSharedLegacyReview } from "./reviews/retire-legacy.js";
import {
  keepLegalworkRuntimeConfigFileFresh,
  legalworkRuntimeConfigFilePath,
  writeLegalworkRuntimeConfigFile,
} from "./legalwork-runtime-config.js";
import { globalOpenCodeConfigPath } from "./mcp.js";
import { importConnectorsIntoSharedRow } from "./mcp-shared-store.js";
import { repairAllWorkspaceRuntimeProviders } from "./runtime-provider-repair.js";
import { prepareManagedOpencodeEngineDb } from "./managed-opencode-db.js";
import { refreshEigenweltPaidManifest } from "./eigenwelt-paid-manifest.js";
import { ensureFreshPlatformToken } from "./eigenwelt-refresh.js";
import type { ServeResult } from "./serve-node.js";
import type { ServerConfig } from "./types.js";

export type HostWorkspaceAppFilesPolicy = {
  path: string;
  appFiles: "outside";
};

export type EmbeddedServerOptions = CliArgs & {
  /** Fallback only; explicit CLI, environment and file approval settings take precedence. */
  defaultApprovalMode?: ServerConfig["approval"]["mode"];
  /** Host-owned approval presentation for manual mode. */
  requestHostApproval?: ServerConfig["requestHostApproval"];
  /** When true, spawn a managed OpenCode child process. */
  manageOpencode?: boolean;
  /** Path to the OpenCode binary. Falls back to LEGALWORK_OPENCODE_BIN env. */
  opencodeBin?: string;
  /** Working directory for the managed OpenCode process. */
  opencodeCwd?: string;
  /** OS-resolved Documents project root provided by the desktop host. */
  projectsDirectory?: string;
  /** Native folder-picker hook, forwarded to ServerConfig.pickDirectory. */
  pickDirectory?: ServerConfig["pickDirectory"];
  /** Desktop recorder hook, forwarded to Office add-in API routes. */
  recorder?: ServerConfig["recorder"];
  /** Outside-mode policy supplied by the embedding host before workspace initialization. */
  hostWorkspaceAppFiles?: readonly HostWorkspaceAppFilesPolicy[];
};

function isPathInside(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.includes(`..${sep}`));
}

function applyHostWorkspaceAppFilesPolicy(
  config: ServerConfig,
  policies: readonly HostWorkspaceAppFilesPolicy[] | undefined,
): void {
  const outsideRoots = (policies ?? [])
    .filter((policy) => policy.appFiles === "outside" && policy.path.trim())
    .map((policy) => resolve(policy.path));
  if (outsideRoots.length === 0) return;
  for (const workspace of config.workspaces) {
    if (workspace.workspaceType === "remote") continue;
    const workspacePath = resolve(workspace.path);
    if (outsideRoots.some((root) => isPathInside(root, workspacePath))) {
      workspace.appFiles = "outside";
    }
  }
}

export type EmbeddedServerHandle = {
  /** Bound port the HTTP server is listening on. */
  port: number;
  /** Full base URL, e.g. http://127.0.0.1:48123 */
  url: string;
  /** The resolved server config (with OpenCode URLs populated). */
  config: ServerConfig;
  /** Redacted details for the managed OpenCode child process, when spawned. */
  managedOpencodeExecution: OpencodeExecutionSnapshot | null;
  managedOpencodeStatus: () => { running: boolean; pid: number | null } | null;
  /** Stop the HTTP server and managed OpenCode (if any). */
  stop: () => Promise<void>;
};

export async function startEmbeddedServer(options: EmbeddedServerOptions): Promise<EmbeddedServerHandle> {
  const config = await resolveServerConfig(options, { approvalMode: options.defaultApprovalMode });
  applyHostWorkspaceAppFilesPolicy(config, options.hostWorkspaceAppFiles);
  config.requestHostApproval = options.requestHostApproval;
  config.pickDirectory = options.pickDirectory ?? null;
  config.projectsDirectory = options.projectsDirectory;
  config.recorder = options.recorder ?? null;
  const serverUrl = `http://${config.host === "0.0.0.0" ? "127.0.0.1" : config.host}:${config.port}`;
  // No trailing slash: the engine appends "/api.json" to this value, so a
  // trailing slash produces the malformed "https://…com//api.json" seen in
  // user-reported engine logs.
  const opencodeModelsUrl = process.env.OPENCODE_MODELS_URL?.trim().replace(/\/+$/, "") || (process.env.LEGALWORK_DEV_MODE === "1"
    ? "http://localhost:8791/models"
    : "https://models.eigenweltlabs.com");

  // Spawn managed OpenCode if requested and no explicit base URL was provided.
  let managedOpencode: ManagedOpencodeServer | null = null;

  if (!config.readOnly) {
    await retireSharedLegacyReview(globalSkillsDir());
    await ensureBundledWorkflows();
    for (const workspace of config.workspaces) {
      if (usesExternalWorkspaceAppFiles(workspace)) {
        const appFilesRoot = workspaceAppFilesRoot(config, workspace);
        await mkdir(appFilesRoot, { recursive: true });
        await ensureWorkspaceFiles(appFilesRoot, workspace.preset, {
          root: workspace.path,
          name: workspace.displayName ?? workspace.name,
        });
      } else {
        await ensureWorkspaceFilesForBootstrap(workspace);
      }
    }
  }
  // Drop retired / unparsable provider blocks from the runtime DB BEFORE the
  // engine config file is built: one bad stored block takes the engine down.
  await repairAllWorkspaceRuntimeProviders(config);
  // Desktop connectors are shared by every workspace. Fold what earlier builds
  // stored per workspace or in files into the shared row before the engine
  // config file is built from it, so nothing already connected disappears.
  const connectorImport = await importConnectorsIntoSharedRow(config, {
    runtimeConfigFile: legalworkRuntimeConfigFilePath(config),
    globalOpencodeConfigFile: globalOpenCodeConfigPath(),
  }).catch((error: unknown) => {
    console.warn(`[embedded] connector import skipped: ${error instanceof Error ? error.message : String(error)}`);
    return { imported: [] as string[], backups: [] as string[] };
  });
  if (connectorImport.backups.length > 0) {
    console.log(`[embedded] connector files backed up before the move: ${connectorImport.backups.join(", ")}`);
  }
  if (connectorImport.imported.length > 0) {
    console.log(`[embedded] moved connectors into the shared store: ${connectorImport.imported.join(", ")}`);
  }

  if (!config.opencodeBaseUrl && options.manageOpencode) {
    // One managed engine has one process-wide OPENCODE_CONFIG_DIR. Select the
    // workspace requested by the embedding host, not merely the first
    // persisted registry item, so a restart on workspace activation isolates
    // its external config, commands and skills from another matter.
    const requestedDirectory = options.opencodeDirectory?.trim();
    const workspace = requestedDirectory
      ? config.workspaces.find((entry) => resolve(entry.path) === resolve(requestedDirectory)) ?? config.workspaces[0]
      : config.workspaces[0];
    if (workspace?.path) {
      // Server-managed config file: the engine re-reads it from disk on every
      // instance rebuild, and keepLegalworkRuntimeConfigFileFresh rewrites it
      // on every runtime-DB write — so disposes always pick up current state.
      const runtimeConfigPath = await writeLegalworkRuntimeConfigFile(config, workspace.id);
      keepLegalworkRuntimeConfigFileFresh(config, workspace.id);
      // Fire-and-forget: refresh the GLOBAL paid manifest's model list around
      // the kept key (no-op when not signed in) with the firm's access token,
      // so the list reflects the admin's on/off choices, then rewrite the
      // engine config so the current models appear across every workspace.
      void ensureFreshPlatformToken(config)
        .catch(() => null)
        .then((platformToken) => refreshEigenweltPaidManifest(config, { platformToken }))
        .then((r) => (r.changed ? writeLegalworkRuntimeConfigFile(config, workspace.id) : undefined))
        .catch(() => undefined);
      const cwd = options.opencodeCwd
        || process.env.LEGALWORK_MANAGED_OPENCODE_CWD?.trim()
        || workspace.path;
      await mkdir(cwd, { recursive: true });

      // Private engine DB: never share OpenCode's global opencode.db with a
      // separately installed OpenCode — a newer install migrates it to a
      // schema the pinned sidecar can't open, which kills provider listing,
      // MCP connect, and session create (issue #62). Also exported to
      // process.env so server-side direct DB access (opencode-db.ts) targets
      // the same file the engine writes.
      const managedDb = await prepareManagedOpencodeEngineDb(config);
      if (managedDb) process.env.OPENCODE_DB = managedDb.path;

      managedOpencode = await createManagedOpencodeServer({
        bin: options.opencodeBin || process.env.LEGALWORK_OPENCODE_BIN,
        cwd,
        excludedPorts: [config.port],
        env: {
          ...(process.env.LEGALWORK_DEV_MODE ? { LEGALWORK_DEV_MODE: process.env.LEGALWORK_DEV_MODE } : {}),
          ...(process.env.LEGALWORK_UI_CONTROL_DISCOVERY ? { LEGALWORK_UI_CONTROL_DISCOVERY: process.env.LEGALWORK_UI_CONTROL_DISCOVERY } : {}),
          LEGALWORK_SERVER_URL: serverUrl,
          LEGALWORK_SERVER_TOKEN: config.token,
          OPENCODE_CONFIG: runtimeConfigPath,
          // OpenCode v1.18.29 discovers commands and skills from this
          // directory. It is deliberately set only for the active managed
          // workspace because the engine exposes one process-wide config root.
          ...(externalOpencodeConfigDir(config, workspace)
            ? {
                OPENCODE_CONFIG_DIR: externalOpencodeConfigDir(config, workspace)!,
                OPENCODE_DISABLE_PROJECT_CONFIG: "true",
              }
            : {}),
          OPENCODE_MODELS_URL: opencodeModelsUrl,
          ...(managedDb ? { OPENCODE_DB: managedDb.path } : {}),
        },
      });

      config.opencodeBaseUrl = managedOpencode.url;
      config.opencodeUsername = managedOpencode.username;
      config.opencodePassword = managedOpencode.password;
      for (const entry of config.workspaces) {
        if (entry.workspaceType === "remote") {
          entry.baseUrl ??= managedOpencode.url;
          entry.opencodeUsername ??= managedOpencode.username;
          entry.opencodePassword ??= managedOpencode.password;
          entry.directory ??= entry.path;
          continue;
        }
        entry.baseUrl = managedOpencode.url;
        entry.opencodeUsername = managedOpencode.username;
        entry.opencodePassword = managedOpencode.password;
        entry.directory = entry.path;
      }
    }
  }

  const server = await startServer(config);

  // The runtime config file above only covers workspaces[0]. Push every
  // workspace's runtime-DB MCPs into the engine so they aren't invisible
  // until a manual reload. Best-effort.
  if (managedOpencode) {
    void syncAllWorkspacesRuntimeMcpToEngine(config);
  }

  return {
    port: server.port,
    url: `http://${config.host === "0.0.0.0" ? "127.0.0.1" : config.host}:${server.port}`,
    config,
    managedOpencodeExecution: managedOpencode?.execution ?? null,
    managedOpencodeStatus: () => managedOpencode
      ? { running: managedOpencode.running(), pid: managedOpencode.pid }
      : null,
    async stop() {
      await managedOpencode?.close();
      await server.stop();
    },
  };
}
