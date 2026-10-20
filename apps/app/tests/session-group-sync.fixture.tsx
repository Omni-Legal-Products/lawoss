import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { resolveWorkspaceEndpoint } from "../src/app/lib/workspace-endpoint";
import { useSessionGroupSync } from "../src/react-app/shell/use-session-group-sync";
import { PROJECT_FOLDER_RECONNECTED_EVENT } from "../src/react-app/domains/workspace/project-folder-recovery";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";

/** Real mounted hook + native HTTP client, isolated synthetic transport and clock. */
export async function runSessionGroupSyncFixture() {
  const originals = { fetch: Object.getOwnPropertyDescriptor(globalThis, "fetch"), now: Object.getOwnPropertyDescriptor(Date, "now"), interval: Object.getOwnPropertyDescriptor(window, "setInterval"), clear: Object.getOwnPropertyDescriptor(window, "clearInterval"), warn: Object.getOwnPropertyDescriptor(console, "warn") };
  const timeout = window.setTimeout.bind(window);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const calls = new Map<string, number>(); let warnings = 0; let now = 0; let restored = false; let unmounted = false;
  const intervals = new Map<number, () => void>(); let nextInterval = 900000;
  const api = `${location.origin}/__session_group_fixture`;
  let workspaces: RouteWorkspace[] = Array.from({ length: 8 }, (_, index) => ({ id: `fixture-${index}`, name: "Synthetic", displayNameResolved: "Synthetic", path: `/synthetic/project-${index}`, preset: "starter", workspaceType: "local" }));
  const endpointForWorkspace = (workspace: RouteWorkspace | null | undefined) => resolveWorkspaceEndpoint(workspace, { baseUrl: api, token: "synthetic-only" });
  function Probe({ items }: { items: RouteWorkspace[] }) { useSessionGroupSync({ workspaces: items, endpointForWorkspace }); return null; }
  const render = () => flushSync(() => root.render(<Probe items={workspaces} />));
  const settle = async () => { await new Promise<void>(resolve => timeout(resolve, 0)); await new Promise<void>(resolve => timeout(resolve, 0)); };
  let checks = 0;
  const check = (value: boolean, name: string) => { checks++; if (!value) throw new Error(`Mounted session group check ${checks}: ${name}; ${JSON.stringify(Object.fromEntries(calls))}; warnings=${warnings}`); };
  try {
    Object.defineProperty(Date, "now", { configurable: true, value: () => now });
    Object.defineProperty(console, "warn", { configurable: true, value: (...args: unknown[]) => { if (typeof args[0] === "string" && args[0].startsWith("[session-groups]")) warnings++; } });
    Object.defineProperty(window, "setInterval", { configurable: true, value: (callback: TimerHandler, milliseconds?: number) => {
      if (milliseconds !== 3000 || typeof callback !== "function") throw new Error("Unexpected fixture interval");
      const id = nextInterval++; intervals.set(id, () => callback()); return id;
    } });
    Object.defineProperty(window, "clearInterval", { configurable: true, value: (id: number) => { intervals.delete(id); } });
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (!url.href.startsWith(api + "/workspace/")) throw new Error("Unowned fixture request");
      const id = url.pathname.match(/workspace\/(fixture-\d+)\//)?.[1]; if (!id) throw new Error("Missing fixture owner");
      const kind = url.pathname.endsWith("/events") ? "events" : "state";
      const key = `${id}:${kind}`; calls.set(key, (calls.get(key) ?? 0) + 1);
      if (id !== "fixture-7" && !restored) return Response.json({ code: "project_folder_unavailable", message: "Synthetic missing folder" }, { status: 409 });
      return Response.json(kind === "events" ? { cursor: 0, items: [] } : { state: { groups: [], assignments: {} }, updatedAt: null });
    } });
    render(); await settle();
    for (let tick = 1; tick <= 600; tick++) {
      now = tick * 3000; workspaces = workspaces.map(workspace => ({ ...workspace, displayNameResolved: `Metadata ${tick}` }));
      render(); for (const callback of intervals.values()) callback(); await settle();
    }
    for (let index = 0; index < 7; index++) check(calls.get(`fixture-${index}:state`) === 1, "missing root initial sync must not repeat");
    check((calls.get("fixture-7:events") ?? 0) >= 590, "available workspace continues polling");
    check(calls.get("fixture-7:state") === 1, "metadata does not restart initial migration");
    check(warnings === 7, "one warning per unavailable generation");
    restored = true; window.dispatchEvent(new Event(PROJECT_FOLDER_RECONNECTED_EVENT)); await settle();
    for (let index = 0; index < 7; index++) check(calls.get(`fixture-${index}:state`) === 2, "explicit recovery resumes paused root");
    workspaces = workspaces.map(workspace => workspace.id === "fixture-0" ? { ...workspace, path: "/synthetic/moved" } : workspace);
    render(); await settle(); check(calls.get("fixture-0:state") === 3, "changed root starts new generation");
    flushSync(() => root.unmount()); unmounted = true; check(intervals.size === 0, "unmount releases timer");
    return { schema: 1, checks, simulatedMinutes: 30, warnings, calls: Object.fromEntries(calls), actualMountedHook: true, actualHttpClient: true };
  } finally {
    if (!unmounted) flushSync(() => root.unmount()); host.remove();
    for (const [target, key, descriptor] of [[globalThis, "fetch", originals.fetch], [Date, "now", originals.now], [window, "setInterval", originals.interval], [window, "clearInterval", originals.clear], [console, "warn", originals.warn]] satisfies Array<[object, string, PropertyDescriptor | undefined]>) {
      if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key);
    }
  }
}
