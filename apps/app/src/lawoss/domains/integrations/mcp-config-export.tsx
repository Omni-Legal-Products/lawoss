/** @jsxImportSource react */
import { useEffect, useReducer } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { McpServerEntry, McpServerSource } from "../../../app/types";
import {
  buildMcpConfigExport,
  type McpConfigExport,
  type McpConfigExportEntry,
} from "../../okf/mcp-config-export";

export type LocalDownloadFile = {
  filename: string;
  content: string;
  mimeType: "application/json";
};

export type LocalDownload = (file: LocalDownloadFile) => void;

type DownloadAnchor = {
  href: string;
  download: string;
  hidden: boolean;
  click: () => void;
  remove: () => void;
};

export type BrowserDownloadPort = {
  createBlob: (content: string, mimeType: "application/json") => Blob;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  createAnchor: () => DownloadAnchor;
  appendAnchor: (anchor: DownloadAnchor) => void;
};

const browserDownloadPort: BrowserDownloadPort = {
  createBlob: (content, mimeType) => new Blob([content], { type: mimeType }),
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  createAnchor: () => document.createElement("a"),
  appendAnchor: (anchor) => document.body.append(anchor as HTMLAnchorElement),
};

export function downloadMcpConfigJson(file: LocalDownloadFile, port: BrowserDownloadPort = browserDownloadPort): void {
  const blob = port.createBlob(file.content, file.mimeType);
  const url = port.createObjectURL(blob);
  let anchor: DownloadAnchor | null = null;
  try {
    anchor = port.createAnchor();
    anchor.href = url;
    anchor.download = file.filename;
    anchor.hidden = true;
    port.appendAnchor(anchor);
    anchor.click();
  } finally {
    anchor?.remove();
    port.revokeObjectURL(url);
  }
}

export type McpConfigExportDialogState = {
  open: boolean;
  selectedNames: string[];
  confirmed: boolean;
  approvedEntries: readonly McpConfigExportEntry[] | null;
  approvedWorkspaceIdentity: string | null;
  approvedSelectionKey: string | null;
  error: string | null;
};

export const initialMcpConfigExportDialogState: McpConfigExportDialogState = {
  open: false,
  selectedNames: [],
  confirmed: false,
  approvedEntries: null,
  approvedWorkspaceIdentity: null,
  approvedSelectionKey: null,
  error: null,
};

type McpConfigExportApproval = {
  entries: readonly McpConfigExportEntry[];
  workspaceIdentity: string;
  selectionKey: string;
};

export type McpConfigExportDialogAction =
  | { type: "open" }
  | { type: "reset" }
  | { type: "toggle"; name: string }
  | { type: "confirm"; value: false }
  | { type: "confirm"; value: true; approval: McpConfigExportApproval }
  | { type: "error"; message: string };

function withoutApproval(state: McpConfigExportDialogState): McpConfigExportDialogState {
  return {
    ...state,
    confirmed: false,
    approvedEntries: null,
    approvedWorkspaceIdentity: null,
    approvedSelectionKey: null,
  };
}

export function mcpConfigExportSelectionKey(selectedNames: readonly string[]): string {
  return JSON.stringify([...selectedNames].sort((left, right) => left < right ? -1 : left > right ? 1 : 0));
}

export function mcpConfigExportApprovalIsCurrent(
  state: McpConfigExportDialogState,
  entries: readonly McpConfigExportEntry[],
  workspaceIdentity: string,
): boolean {
  return state.confirmed &&
    state.approvedEntries === entries &&
    state.approvedWorkspaceIdentity === workspaceIdentity &&
    state.approvedSelectionKey === mcpConfigExportSelectionKey(state.selectedNames);
}

export function mcpConfigExportDialogReducer(
  state: McpConfigExportDialogState,
  action: McpConfigExportDialogAction,
): McpConfigExportDialogState {
  if (action.type === "open") return { ...initialMcpConfigExportDialogState, open: true };
  if (action.type === "reset") return initialMcpConfigExportDialogState;
  if (action.type === "confirm") {
    if (!action.value) return { ...withoutApproval(state), error: null };
    return {
      ...state,
      confirmed: true,
      approvedEntries: action.approval.entries,
      approvedWorkspaceIdentity: action.approval.workspaceIdentity,
      approvedSelectionKey: action.approval.selectionKey,
      error: null,
    };
  }
  if (action.type === "error") return { ...state, error: action.message };
  const selectedNames = state.selectedNames.includes(action.name)
    ? state.selectedNames.filter((name) => name !== action.name)
    : [...state.selectedNames, action.name];
  return { ...withoutApproval(state), selectedNames, error: null };
}

export function runMcpConfigExportDownload(options: {
  state: McpConfigExportDialogState;
  entries: readonly McpConfigExportEntry[];
  workspaceIdentity: string;
  filename: string;
  download: LocalDownload;
}): McpConfigExport {
  if (!options.state.open || !options.state.confirmed) throw new Error("Confirm the MCP export first");
  if (!mcpConfigExportApprovalIsCurrent(options.state, options.entries, options.workspaceIdentity)) {
    throw new Error("MCP export approval is stale");
  }
  const result = buildMcpConfigExport(options.entries, options.state.selectedNames);
  options.download({ filename: options.filename, content: result.json, mimeType: "application/json" });
  return result;
}

export function mcpConfigExportFilename(workspaceLabel: string): string {
  const slug = workspaceLabel
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 80);
  return `${slug || "workspace"}-mcp.json`;
}

function sourceLabel(source: McpServerSource | undefined): string {
  if (source === "config.project") return "Konfigurácia workspace";
  if (source === "config.global") return "Globálna OpenCode konfigurácia";
  if (source === "config.remote") return "Spravovaný runtime (rozsah nie je overený)";
  return "Neznámy zdroj";
}

function disabledLabel(entry: McpServerEntry): string | null {
  const reasons: string[] = [];
  if (entry.config.enabled === false) reasons.push("vypnutý v konfigurácii");
  if (entry.disabledByTools === true) reasons.push("vypnutý pravidlami tools");
  if (!reasons.length) return null;
  return reasons.join(", ");
}

export function McpConfigExportDialog(props: {
  entries: readonly McpServerEntry[];
  workspaceIdentity: string;
  download?: LocalDownload;
}) {
  const [state, dispatch] = useReducer(mcpConfigExportDialogReducer, initialMcpConfigExportDialogState);
  useEffect(() => dispatch({ type: "reset" }), [props.workspaceIdentity, props.entries]);

  const selectedSet = new Set(state.selectedNames);
  const sourceCounts = state.selectedNames.reduce<Record<string, number>>((counts, name) => {
    const entry = props.entries.find((candidate) => candidate.name === name);
    const label = sourceLabel(entry?.source);
    counts[label] = (counts[label] ?? 0) + 1;
    return counts;
  }, {});
  const download = props.download ?? downloadMcpConfigJson;
  const approvalCurrent = mcpConfigExportApprovalIsCurrent(state, props.entries, props.workspaceIdentity);

  const submit = () => {
    try {
      runMcpConfigExportDownload({
        state,
        entries: props.entries,
        workspaceIdentity: props.workspaceIdentity,
        filename: mcpConfigExportFilename(props.workspaceIdentity),
        download,
      });
      dispatch({ type: "reset" });
    } catch (error) {
      dispatch({
        type: "error",
        message: error instanceof Error ? error.message : "Export MCP konfigurácie zlyhal.",
      });
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => dispatch({ type: "open" })}>
        <Download size={14} />
        Exportovať MCP
      </Button>
      <Dialog
        open={state.open}
        onOpenChange={(open) => dispatch(open ? { type: "open" } : { type: "reset" })}
      >
        <DialogContent className="max-w-xl sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Exportovať MCP konfiguráciu</DialogTitle>
            <DialogDescription>
              Vyberte konektory, ktoré sa majú uložiť do lokálneho OpenCode JSON súboru.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-64 space-y-2 overflow-y-auto">
            {props.entries.length ? props.entries.map((entry) => {
              const effectiveStateKnown = typeof entry.disabledByTools === "boolean";
              const disabled = disabledLabel(entry);
              return (
                <label key={entry.name} className="flex items-start gap-3 rounded-xl border border-dls-border p-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4"
                    checked={selectedSet.has(entry.name)}
                    disabled={!effectiveStateKnown}
                    onChange={() => dispatch({ type: "toggle", name: entry.name })}
                  />
                  <span className="min-w-0">
                    <span className="block break-all text-sm font-medium text-dls-text">{entry.name}</span>
                    <span className="block text-xs text-dls-secondary">{sourceLabel(entry.source)}</span>
                    {disabled ? <span className="block text-xs text-amber-11">{disabled}; export zostane vypnutý</span> : null}
                    {!effectiveStateKnown ? (
                      <span className="block text-xs text-red-11">Neoverený efektívny stav — export nie je dostupný.</span>
                    ) : null}
                  </span>
                </label>
              );
            }) : (
              <p className="text-sm text-dls-secondary">Nie sú dostupné žiadne MCP konektory.</p>
            )}
          </div>

          <div className="rounded-xl border border-amber-6 bg-amber-2 p-3 text-xs leading-relaxed text-amber-11">
            Export môže obsahovať tajomstvá v URL, hlavičkách, premenných prostredia, OAuth clientSecret alebo argumentoch príkazu.
            OAuth prístupové a obnovovacie tokeny sa neexportujú; po obnove môže byť potrebné nové prihlásenie.
          </div>

          <div className="space-y-1 text-xs text-dls-secondary">
            <p>Vybrané konektory: {state.selectedNames.length}</p>
            {Object.entries(sourceCounts).map(([source, count]) => <p key={source}>{source}: {count}</p>)}
            <p>Konektor vypnutý pravidlami tools sa uloží so štandardným enabled: false; samotné tools pravidlá nie sú súčasťou exportu.</p>
          </div>

          <label className="flex items-start gap-3 text-sm text-dls-text">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={state.confirmed}
              disabled={state.selectedNames.length === 0}
              onChange={(event) => dispatch(event.currentTarget.checked ? {
                type: "confirm",
                value: true,
                approval: {
                  entries: props.entries,
                  workspaceIdentity: props.workspaceIdentity,
                  selectionKey: mcpConfigExportSelectionKey(state.selectedNames),
                },
              } : { type: "confirm", value: false })}
            />
            Rozumiem, že súbor môže obsahovať citlivé konfiguračné hodnoty.
          </label>
          {state.error ? <p role="alert" className="text-sm text-red-11">{state.error}</p> : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => dispatch({ type: "reset" })}>Zrušiť</Button>
            <Button disabled={!approvalCurrent || state.selectedNames.length === 0} onClick={submit}>
              Stiahnuť vybrané MCP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
