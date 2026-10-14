/** @jsxImportSource react */
import type { ReactNode } from "react";
import type { McpDirectoryInfo } from "../../../app/constants";
import { extensionContribution } from "../../../app/extensions";
import type { LegalworkServerClient } from "../../../app/lib/legalwork-server";

/**
 * Context bag that the settings route passes to extension config factories.
 * Each extension picks what it needs; unused fields are ignored.
 */
export type ExtensionConfigContext = {
  legalworkServerClient?: LegalworkServerClient | null;
  hostLegalworkServerClient?: LegalworkServerClient | null;
  extensionConnections?: Record<string, boolean>;
  onExtensionConnectionChange?: (extensionId: string, connected: boolean) => void;
  restartLocalServer?: () => Promise<boolean>;
  actaport?: {
    connected: boolean;
    onConnect: () => boolean | void | Promise<boolean | void>;
    onDisconnect: () => void | Promise<void>;
    onRefresh: () => void | Promise<void>;
  };
  openComputerUse?: {
    localDesktop: boolean;
    connected: boolean;
    connecting: boolean;
    onConnect: () => Promise<boolean>;
    onRefresh: () => void | Promise<void>;
  };
  imageExtension: {
    busy: boolean;
    status: string | null;
    error: string | null;
    envKeyDetected: boolean;
    onInstall: (apiKey: string) => void | Promise<void>;
    onTestGenerate: (input: { apiKey: string; prompt: string }) => void | Promise<void>;
  };
  localProvider: {
    busy: boolean;
    status: string | null;
    error: string | null;
    onInstall: (input: {
      providerId: string;
      name: string;
      baseURL: string;
      modelId: string;
      modelName: string;
      setDefault: boolean;
    }) => void | Promise<void>;
  };
};

export type ExtensionConfigFactory = (ctx: ExtensionConfigContext) => ReactNode;

export type ExtensionRuntimeContext = Pick<
  ExtensionConfigContext,
  "legalworkServerClient" | "extensionConnections" | "onExtensionConnectionChange"
>;

export type LegalWorkExtensionRuntime = {
  id: string;
  settingsPanel?: ExtensionConfigFactory;
  settingsPanelRefs?: string[];
  isConnected?: (entry: McpDirectoryInfo, ctx: ExtensionRuntimeContext) => boolean;
};

const registry = new Map<string, ExtensionConfigFactory>();
const runtimeRegistry = new Map<string, LegalWorkExtensionRuntime>();

export function registerExtensionConfig(id: string, factory: ExtensionConfigFactory) {
  registry.set(id, factory);
}

export function registerExtensionRuntime(runtime: LegalWorkExtensionRuntime) {
  runtimeRegistry.set(runtime.id, runtime);
  if (runtime.settingsPanel) {
    registerExtensionConfig(runtime.id, runtime.settingsPanel);
    for (const ref of runtime.settingsPanelRefs ?? []) {
      registerExtensionConfig(ref, runtime.settingsPanel);
    }
  }
}

function extensionRuntimeId(entry: McpDirectoryInfo) {
  return entry.extensionManifest?.id ?? entry.serverName ?? entry.name;
}

function configRegistryId(entry: McpDirectoryInfo) {
  return extensionContribution(entry.extensionManifest, "settings-panel")?.ref ?? entry.serverName ?? entry.name;
}

export function getExtensionConfigSlot(
  entry: McpDirectoryInfo,
  ctx: ExtensionConfigContext,
): ReactNode | null {
  const id = configRegistryId(entry);
  const factory = registry.get(id);
  return factory ? factory(ctx) : null;
}

export function getExtensionConnected(
  entry: McpDirectoryInfo,
  ctx: ExtensionRuntimeContext,
): boolean | null {
  const runtime = runtimeRegistry.get(extensionRuntimeId(entry));
  return runtime?.isConnected ? runtime.isConnected(entry, ctx) : null;
}
