import { acquireRuntimeDbLifetime } from "./runtime-db-lifecycle.js";
/**
 * Single entry point for embedding the LegalWork server in-process.
 *
 * Handles config resolution, managed OpenCode spawn, and server start
 * in one call -- mirrors what cli.ts does but returns a handle instead
 * of owning the process lifecycle.
 */
import { mkdir } from "node:fs/promises";
import { connectorRuntimeCapability } from "./connectors/capability.js";
import { prepareConnectorStorage } from "./connectors/store.js";
import { bootstrapRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import { join, resolve } from "node:path";
import { engineStorageDir } from "./engine-storage.js";
import { resolveServerConfig, type CliArgs } from "./config.js";
import { resolveEngineExecutable, type ManagedOpencodeServer, type OpencodeExecutionSnapshot } from "./managed-opencode.js";
import { startServer } from "./server.js";
import { ensureWorkspaceFiles, ensureWorkspaceFilesForBootstrap } from "./workspace-init.js";
import { workspaceAppFilesRoot, usesExternalWorkspaceAppFiles } from "./lawoss/workspace-app-files.js";
import { globalSkillsDir } from "./workspace-files.js";
// 🟡 LAWOSS: anglické pribalené workflowy sa neinštalujú (MČ 10. 11. 2026, #255 A2).
import { ensureLawossBundledWorkflows } from "./lawoss/hidden-bundled-workflows.js";
import { retireSharedLegacyReview } from "./reviews/retire-legacy.js";
import {
  keepLegalworkRuntimeConfigFileFresh,
  legalworkRuntimeConfigFilePath,
  writeLegalworkRuntimeConfigFile,
  legalworkMandatoryRuntimeConfigContent,
} from "./legalwork-runtime-config.js";
import { globalOpenCodeConfigPath } from "./mcp.js";
import { importConnectorsIntoSharedRow } from "./mcp-shared-store.js";
import { repairAllWorkspaceRuntimeProviders } from "./runtime-provider-repair.js";
import { prepareManagedOpencodeDependencies } from "./managed-opencode-dependencies.js";
import { prepareManagedOpencodeEngineDb } from "./managed-opencode-db.js";
import { refreshEigenweltPaidManifest } from "./eigenwelt-paid-manifest.js";
import { ensureFreshPlatformToken } from "./eigenwelt-refresh.js";
import type { ServeResult } from "./serve-node.js";
import type { ServerConfig } from "./types.js";
import { orgPolicyEngineDir } from "./org-policy-engine.js";
import { createConfiguredManagedEngine, startManagedEngineLifecycle } from "./managed-engine-lifecycle.js";
import { legacyMcpAuthPath } from "./legacy-mcp-credentials.js";
import { prepareIsolatedEngineHome } from "./lawoss/engine-home.js";
import { expectedOpencodeVersion } from "@legalwork/opencode-release/candidate";
import { issueWikiAgentTicket } from "./wiki/agent-access.js";
import { settleEngineAgentTicket } from "./lawoss/engine-agent-ticket.js";
import { WIKI_AGENT_TICKET_ENV } from "./lawoss/engine-agent-contract.js";
// 🟡 LAWOSS: na Windows relative() medzi diskami vráti absolútnu cestu bez "..".
import { isPathWithin } from "./lawoss/path-within.js";

export type HostWorkspaceAppFilesPolicy = {
  path: string;
  appFiles: "outside";
};

export type EmbeddedServerOptions = CliArgs & {
  getUiLocale?: ServerConfig["getUiLocale"];
  /** Publish the bound API while the managed engine is still starting/migrating. */
  onListening?: (connection: { port: number; url: string }) => void;
  /** Desktop networking stack, including its system proxy, for model assets. */
  modelDownloadFetch?: import("./ocr/models.js").ModelDownloadFetch;
  /** Host-resolved existing Node/OpenSSL runtime for policy-controlled HTTP hops. Never read from configuration or HTTP. */
  rawHttpNodeExecutable?: () => string;
  /** Existing physical Node/image modules for isolated, cancellable image crops. Host-only. */
  toolImageRasterRuntime?: import("./types.js").ServerRuntimeOptions["toolImageRasterRuntime"];
  /** Host-resolved bundled SDK location, including the desktop development build. */
  opencodeSdkDirectory?: string;
  decryptLegacyConnectorSecrets?: ServerConfig["decryptLegacyConnectorSecrets"];
  /** Fallback only; explicit CLI, environment and file approval settings take precedence. */
  defaultApprovalMode?: ServerConfig["approval"]["mode"];
  /** Host-owned approval presentation for manual mode. */
  requestHostApproval?: ServerConfig["requestHostApproval"];
  /** When true, spawn a managed OpenCode child process. */
  manageOpencode?: boolean;
  /** Host-only existing execution boundary; desktop defaults to protected. */
  managedEngineSandbox?: boolean;
  /** Path to the OpenCode binary. Falls back to LEGALWORK_OPENCODE_BIN env. */
  opencodeBin?: string;
  /** Host-only artifact capability, unavailable to HTTP or configuration files. */
  opencodeCandidateBuild?: import("@legalwork/opencode-release/candidate").VerifiedOpencodeCandidate;
  /** Working directory for the managed OpenCode process. */
  opencodeCwd?: string;
  /** OS-resolved Documents project root provided by the desktop host. */
  projectsDirectory?: string;
  /** Native folder-picker hook, forwarded to ServerConfig.pickDirectory. */
  pickDirectory?: ServerConfig["pickDirectory"];
  /** LAWOSS: OS Trash hook, forwarded to ServerConfig.trashItem (lawoss/file-operations.ts). */
  trashItem?: ServerConfig["trashItem"];
  /** Desktop recorder hook, forwarded to Office add-in API routes. */
  recorder?: ServerConfig["recorder"];
  /** Outside-mode policy supplied by the embedding host before workspace initialization. */
  hostWorkspaces?: readonly import("./types.js").WorkspaceConfig[];
  reconnectHostWorkspace?: ServerConfig["reconnectHostWorkspace"];
  hostWorkspaceAppFiles?: readonly HostWorkspaceAppFilesPolicy[];
};

function applyHostWorkspaceAppFilesPolicy(
  config: ServerConfig,
  policies: readonly HostWorkspaceAppFilesPolicy[] | undefined,
): void {
  const outsideRoots = (policies ?? [])
    .filter((policy) => policy.appFiles === "outside" && policy.path.trim())
    .map((policy) => resolve(policy.path));
  if (outsideRoots.length === 0) return;
  for (const workspace of config.workspaces) {
    const workspacePath = resolve(workspace.path);
    if (outsideRoots.some((root) => isPathWithin(root, workspacePath))) {
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
  /** Host-only notification after a successful explicit OS trust change. */
  invalidateRawHttpTrust: () => void;
};

export async function startEmbeddedServer(options: EmbeddedServerOptions): Promise<EmbeddedServerHandle> {
  const config = await resolveServerConfig(options, { approvalMode: options.defaultApprovalMode });
  if (options.workspaces.length && options.hostWorkspaces) {
    const { buildWorkspaceInfos } = await import("./workspaces.js");
    const hostEntries = buildWorkspaceInfos([...options.hostWorkspaces], process.cwd());
    config.workspaces = config.workspaces.map(entry => hostEntries.find(host => host.path === entry.path) ?? entry);
  }
  config.reconnectHostWorkspace = options.reconnectHostWorkspace;
  applyHostWorkspaceAppFilesPolicy(config, options.hostWorkspaceAppFiles);
  config.decryptLegacyConnectorSecrets = options.decryptLegacyConnectorSecrets;
  const managedEngine = options.manageOpencode === true && !config.opencodeBaseUrl;
  if (managedEngine) await expectedOpencodeVersion(options.opencodeBin?.trim() || "opencode", options.opencodeCandidateBuild);
  config.agentSandboxEnabled = managedEngine && options.managedEngineSandbox !== false;
  config.engineProjectTrustRequired = managedEngine;
  config.engineConfigurationMode = "native-project";
  config.requestHostApproval = options.requestHostApproval;
  config.getUiLocale = options.getUiLocale;
  config.pickDirectory = options.pickDirectory ?? null;
  config.trashItem = options.trashItem ?? null;
  config.projectsDirectory = options.projectsDirectory;
  config.recorder = options.recorder ?? null;

  // Spawn managed OpenCode if requested and no explicit base URL was provided.
  const managed: {
    engine: ManagedOpencodeServer | null;
    lifecycle: Awaited<ReturnType<typeof startManagedEngineLifecycle>> | null;
  } = { engine: null, lifecycle: null };
  const lifetime = acquireRuntimeDbLifetime(config);
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let unsubscribe: (() => Promise<void>) | undefined;
  let refresh: Promise<unknown> = Promise.resolve();
  let ticketSettled: Promise<unknown> = Promise.resolve();
  // LAWOSS: the client the managed engine is started for; its location settles the agent ticket.
  let managedWorkspacePath: string | undefined;
  const ticketStop = new AbortController();
  let stopped = false;
  let stopPromise: Promise<void> | undefined;
  const stop = () => {
    if (stopPromise) return stopPromise;
    stopped = true;
    stopPromise = (async () => {
      const errors: unknown[] = [];
      // Unsubscribe synchronously; accepted writes and jobs still drain before the owner releases.
      const freshness = unsubscribe?.();
      ticketStop.abort();
      for (const operation of [() => freshness, () => ticketSettled, () => refresh,
        () => managed.lifecycle ? managed.lifecycle.close() : managed.engine?.close(), () => server?.stop(), () => lifetime.release()]) {
        try { await operation(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, "Failed to stop embedded server resources");
    })();
    return stopPromise;
  };
  try { return await lifetime.run(async () => {

  // Desktop startup owns this one-time transition, before provider repair or
  // connector imports can observe the current configuration.
  await bootstrapRuntimeOpencodeConfig(config);
  await prepareConnectorStorage(config);

  if (!config.readOnly) {
    await retireSharedLegacyReview(globalSkillsDir());
    await ensureLawossBundledWorkflows();
    for (const workspace of config.workspaces) {
      // A disconnected cloud project must not prevent the shared server from
      // starting. Its requests retry initialization and return the real error.
      try {
        if (usesExternalWorkspaceAppFiles(workspace)) {
          // LAWOSS: app files outside the client folder (lawoss/workspace-app-files.ts).
          const appFilesRoot = workspaceAppFilesRoot(config, workspace);
          await mkdir(appFilesRoot, { recursive: true });
          await ensureWorkspaceFiles(appFilesRoot, workspace.preset, {
            bundledCore: !managedEngine,
            root: workspace.path,
            name: workspace.displayName ?? workspace.name,
          });
        } else {
          await ensureWorkspaceFilesForBootstrap(workspace, { bundledCore: !managedEngine });
        }
      } catch (error: unknown) {
        console.warn(`[workspace-init] ${workspace.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  // Validate saved providers before building engine configuration. Only retired
  // app-owned definitions are removed; invalid user connections remain intact.
  await repairAllWorkspaceRuntimeProviders(config);
  // Desktop connectors are shared by every workspace. Fold what earlier builds
  // stored per workspace or in files into the shared row before the engine
  // config file is built from it, so nothing already connected disappears.
  const connectorImport = await importConnectorsIntoSharedRow(config, {
    runtimeConfigFile: legalworkRuntimeConfigFilePath(config),
    globalOpencodeConfigFile: globalOpenCodeConfigPath(),
  }).catch((error: unknown) => {
    console.warn(`[embedded] connector import skipped: ${error instanceof Error ? error.message : String(error)}`);
    return { imported: [] as string[] };
  });
  if (connectorImport.imported.length > 0) {
    console.log(`[embedded] moved connectors into the shared store: ${connectorImport.imported.join(", ")}`);
  }

  server = await startServer(config, { modelDownloadFetch: options.modelDownloadFetch, publicEngineBinary: () => managed.engine?.execution.command,
    ...(options.rawHttpNodeExecutable ? { rawHttpNodeExecutable: options.rawHttpNodeExecutable } : {}),
    ...(options.toolImageRasterRuntime ? { toolImageRasterRuntime: options.toolImageRasterRuntime } : {}), onListening: async (port) => {
    const serverUrl = `http://${config.host === "0.0.0.0" ? "127.0.0.1" : config.host}:${port}`;
    options.onListening?.({ port, url: serverUrl });
    if (!config.opencodeBaseUrl && options.manageOpencode) {
      // LAWOSS: the workspace requested by the embedding host is the one opened
      // first (its location answers the agent ticket probe). The engine's config
      // root stays the neutral firm-policy folder for every client; an outside
      // client's settings reach only its own locations (lawoss-outside-config.ts).
      const requestedDirectory = options.opencodeDirectory?.trim();
      const workspace = requestedDirectory
        ? config.workspaces.find((entry) => resolve(entry.path) === resolve(requestedDirectory)) ?? config.workspaces[0]
        : config.workspaces[0];
      if (workspace?.path) {
        managedWorkspacePath = workspace.path;
        // Server-managed config file: the engine re-reads it from disk on every
        // instance rebuild, and keepLegalworkRuntimeConfigFileFresh rewrites it
        // on every runtime-DB write — so disposes always pick up current state.
        const runtimeConfigPath = await writeLegalworkRuntimeConfigFile(config, workspace.id);
        unsubscribe = keepLegalworkRuntimeConfigFileFresh(config, workspace.id);
        // Fire-and-forget: refresh the GLOBAL paid manifest's model list around
        // the kept key (no-op when not signed in) with the firm's access token,
        // so the list reflects the admin's on/off choices, then rewrite the
        // engine config so the current models appear across every workspace.
        refresh = ensureFreshPlatformToken(config)
          .catch(() => null)
          .then((platformToken) => refreshEigenweltPaidManifest(config, { platformToken }))
          .then((r) => (r.changed && !stopped ? writeLegalworkRuntimeConfigFile(config, workspace.id) : undefined))
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

        // LAWOSS: bez relé katalógu modelov a bez OPENCODE_MODELS_URL. Engine číta
        // pribalený katalóg a nič nesťahuje (lawossEngineEnv v managed-opencode.ts).
        const engineHome = join(engineStorageDir(config), "engine-home");
        await mkdir(engineHome, { recursive: true });
        // 🟡 LAWOSS: dáta a cache enginu pod engine-home, raz prenesené prihlásenia (lawoss/engine-home.ts).
        const isolatedEngineEnv = await prepareIsolatedEngineHome(engineHome);
        const database = managedDb?.path || (process.env.OPENCODE_DB ? resolve(cwd, process.env.OPENCODE_DB) : "");
        if (!database) throw new Error("A private managed engine database is required for native restart recovery.");
        process.env.OPENCODE_DB = database;
        const executablePath = await resolveEngineExecutable(options.opencodeBin?.trim() || process.env.LEGALWORK_OPENCODE_BIN?.trim() || "opencode", options.opencodeCwd || process.env.LEGALWORK_MANAGED_OPENCODE_CWD?.trim() || engineHome, process.env);
        await expectedOpencodeVersion(executablePath, options.opencodeCandidateBuild);
        const service = { configDirectory: orgPolicyEngineDir(config), stateDirectory: join(engineHome, "state"), executablePath };
        const dependencies = await prepareManagedOpencodeDependencies(config, options.opencodeSdkDirectory);
        if (dependencies.reason === "bundle-unavailable") console.warn("[legalwork-server] Prepare desktop resources to validate the released engine's bundled runtime declaration.");
        managed.lifecycle = await startManagedEngineLifecycle({ config, database, service, legacyMcpAuthPath: legacyMcpAuthPath(), create: async (mode, beforeSpawn) => {
          const engine = await createConfiguredManagedEngine(config, {
          bin: executablePath,
          candidateBuild: options.opencodeCandidateBuild,
          cwd: options.opencodeCwd || process.env.LEGALWORK_MANAGED_OPENCODE_CWD?.trim() || engineHome,
          beforeSpawn,
          ...(mode === "service" ? { service } : { parentLease: true }),
          excludedPorts: [config.port],
          env: {
            ...(process.env.LEGALWORK_DEV_MODE ? { LEGALWORK_DEV_MODE: process.env.LEGALWORK_DEV_MODE } : {}),
            ...(process.env.LEGALWORK_UI_CONTROL_DISCOVERY ? { LEGALWORK_UI_CONTROL_DISCOVERY: process.env.LEGALWORK_UI_CONTROL_DISCOVERY } : {}),
            LEGALWORK_SERVER_URL: serverUrl,
            // LAWOSS: no server-wide token and no agent secret, only its single-use ticket.
            // Plugins name their chat; the server limits each call to its own workspace (wiki/agent-access.ts).
            [WIKI_AGENT_TICKET_ENV]: issueWikiAgentTicket(config),
            LEGALWORK_CONNECTOR_TOKEN: connectorRuntimeCapability(config),
            OPENCODE_CONFIG: runtimeConfigPath,
            // App-owned discovery root; native guard hooks enforce firm policy.
            OPENCODE_CONFIG_DIR: orgPolicyEngineDir(config),
            OPENCODE_CONFIG_PROJECT_DISABLE: "",
            OPENCODE_TEST_HOME: engineHome,
            XDG_CONFIG_HOME: join(engineHome, "config"),
            XDG_STATE_HOME: service.stateDirectory,
            ...isolatedEngineEnv,
            OPENCODE_CONFIG_CONTENT: await legalworkMandatoryRuntimeConfigContent(config),
            OPENCODE_DB: database,
          },
          });
          managed.engine = engine;
          return engine;
        } });

      }
    }
  } });

  // LAWOSS: not awaited, a cold plugin load must not delay startup; no instance serves anything before it.
  // The probe builds the opened client's location (plugins and MCP); admit it into the MCP budget (RAM 2 GB).
  if (managed.engine) ticketSettled = settleEngineAgentTicket(config, managed.engine, managedWorkspacePath ?? config.workspaces[0]?.path ?? "", ticketStop.signal)
    .catch((error: unknown) => { if (!ticketStop.signal.aborted) console.warn(`[embedded] engine ticket window left open: ${error instanceof Error ? error.message : String(error)}`); });

  const started = server;
  if (!started) throw new Error("Embedded server did not start");
  return {
    port: started.port,
    url: `http://${config.host === "0.0.0.0" ? "127.0.0.1" : config.host}:${started.port}`,
    config,
    invalidateRawHttpTrust: () => started.invalidateRawHttpTrust(),
    get managedOpencodeExecution() { return managed.engine?.execution ?? null; },
    managedOpencodeStatus: () => managed.engine
      ? { running: managed.engine.running(), pid: managed.engine.pid }
      : null,
    stop,
  };
  }); } catch (error) {
    try { await stop(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "Embedded server startup and cleanup failed"); }
    throw error;
  }
}
