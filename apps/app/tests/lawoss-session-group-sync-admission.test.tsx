// LAWOSS: the mounted upstream session-group poller keeps AGENTS.md "Workspace persistence and recovery":
// an unavailable project folder pauses only its own generation until reconnect or root change, and late
// responses of a retired generation are ignored. Real hook + real HTTP client, synthetic transport.
import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { LegalworkServerError } from "../src/app/lib/legalwork-server";
import { resolveWorkspaceEndpoint } from "../src/app/lib/workspace-endpoint";
import { SessionGroupSyncAdmission } from "../src/lawoss/shell/session-group-sync-admission";
import { useSessionManagementStore } from "../src/react-app/domains/session/sidebar/session-management-store";
import { PROJECT_FOLDER_RECONNECTED_EVENT } from "../src/react-app/domains/workspace/project-folder-recovery";
import { useSyncEventsLive } from "../src/react-app/kernel/sync-events";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";
import { useSessionGroupSync } from "../src/react-app/shell/use-session-group-sync";

const API = "http://synthetic-session-groups.test";
const globals = ["window", "IS_REACT_ACT_ENVIRONMENT", "fetch", "setTimeout", "clearTimeout"] as const;
const before = new Map(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const warnBefore = Object.getOwnPropertyDescriptor(console, "warn");
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

afterEach(() => {
  for (const [name, descriptor] of before) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  if (warnBefore) Object.defineProperty(console, "warn", warnBefore);
  useSyncEventsLive.setState({ live: false, metadata: false, baseUrl: null });
  useSessionManagementStore.setState(state => ({
    groupsByWorkspace: Object.fromEntries(Object.entries(state.groupsByWorkspace).filter(([id]) => !id.startsWith("sg-"))),
  }));
});

type Server = {
  calls: Map<string, number>;
  unavailable: Set<string>;
  /** Next request of `${id}:${kind}` answers with the server state at request time, once this gate opens. */
  hold: Map<string, Promise<void>>;
  /** Workspaces whose event poll reports a change (forces a state read). */
  changed: Set<string>;
  label: Map<string, string>;
};

const workspace = (id: string, path = `/synthetic/${id}`): RouteWorkspace =>
  ({ id, name: id, displayNameResolved: id, path, preset: "starter", workspaceType: "local" });
const endpointForWorkspace = (item: RouteWorkspace | null | undefined) => resolveWorkspaceEndpoint(item, { baseUrl: API, token: "synthetic-only" });
const groups = (id: string) => useSessionManagementStore.getState().groupsByWorkspace[id]?.groups.map(group => group.id) ?? [];

function gate() {
  let release = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function mount(run: (control: {
  server: Server;
  warnings: () => number;
  count: (key: string) => number;
  render: (items: RouteWorkspace[]) => Promise<void>;
  cycle: () => Promise<void>;
  reconnect: () => Promise<void>;
  settle: () => Promise<void>;
}) => Promise<void>, initial: RouteWorkspace[], unavailable: string[] = [], batch = false) {
  const win = Object.assign(new EventTarget(), { event: undefined, HTMLIFrameElement: class {}, localStorage: { getItem: () => "1", setItem: () => {}, removeItem: () => {} } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true, writable: true });
  // Poll intervals and request deadlines are parked: every cycle is driven explicitly.
  const parked = new Set<number>(); let nextParked = 1_000_000_000;
  Object.defineProperty(globalThis, "setTimeout", { configurable: true, value: (callback: () => void, ms?: number) => {
    if ((ms ?? 0) < 1000) return realSetTimeout(callback, ms);
    const id = nextParked++; parked.add(id); return id;
  } });
  Object.defineProperty(globalThis, "clearTimeout", { configurable: true, value: (id?: Parameters<typeof clearTimeout>[0]) => {
    if (typeof id === "number" && parked.delete(id)) return;
    realClearTimeout(id);
  } });
  let warnings = 0;
  Object.defineProperty(console, "warn", { configurable: true, value: (...args: unknown[]) => { if (typeof args[0] === "string" && args[0].startsWith("[session-groups]")) warnings++; } });
  const server: Server = { calls: new Map(), unavailable: new Set(unavailable), hold: new Map(), changed: new Set(), label: new Map() };
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== API) throw new Error("Unowned fixture request");
    // An older worker without the batch route keeps the per-workspace protocol.
    if (url.pathname === "/session-groups/events" && !batch) return Response.json({ code: "not_found", message: "Not found" }, { status: 404 });
    if (url.pathname === "/session-groups/events") {
      const cursors: unknown = JSON.parse(url.searchParams.get("cursors") ?? "{}");
      const requested = cursors && typeof cursors === "object" ? Object.entries(cursors) : [];
      // Like the server route, a workspace whose metadata fails with 403/404 is omitted.
      const items = requested.filter(([id]) => !server.unavailable.has(id)).map(([id, since]) => {
        server.calls.set(`${id}:batch`, (server.calls.get(`${id}:batch`) ?? 0) + 1);
        const label = server.label.get(id) ?? `${id}-state`;
        return { workspaceId: id, cursor: 1, ...(since === null || server.changed.has(id) ? { state: { groups: [{ id: label, label }], assignments: {} }, updatedAt: 1 } : {}) };
      });
      const held = server.hold.get("batch");
      if (held) { server.hold.delete("batch"); await held; }
      return Response.json({ items });
    }
    const match = url.pathname.match(/^\/workspace\/(sg-[a-z]+)\/session-groups(\/events)?$/);
    if (!match?.[1]) throw new Error(`Unexpected fixture request ${url.pathname}`);
    const id = match[1]; const kind = match[2] ? "events" : "state"; const key = `${id}:${kind}`;
    server.calls.set(key, (server.calls.get(key) ?? 0) + 1);
    const unavailable = server.unavailable.has(id); const changed = server.changed.has(id); const label = server.label.get(id) ?? `${id}-state`;
    const held = server.hold.get(key);
    if (held) { server.hold.delete(key); await held; }
    if (unavailable) return Response.json({ code: "project_folder_unavailable", message: "Synthetic missing folder" }, { status: 404 });
    if (kind === "events") return Response.json({ cursor: 1, items: changed ? [{ seq: 1 }] : [] });
    return Response.json({ state: { groups: [{ id: label, label }], assignments: {} }, updatedAt: 1 });
  } });
  const { createRoot } = await import("react-dom/client");
  const noop = () => undefined;
  const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", addEventListener: noop, removeEventListener: noop, ownerDocument: { addEventListener: noop, removeEventListener: noop } };
  // A hook-only probe renders nothing; React needs only the container's event surface.
  const root = createRoot(container as unknown as Element);
  function Probe({ items }: { items: RouteWorkspace[] }) { useSessionGroupSync({ workspaces: items, endpointForWorkspace }); return null; }
  const settle = async () => { for (let turn = 0; turn < 12; turn++) await act(async () => { await new Promise<void>(resolve => realSetTimeout(resolve, 0)); }); };
  let tick = 0;
  try {
    await act(async () => root.render(<Probe items={initial} />));
    await settle();
    await run({
      server, warnings: () => warnings, count: key => server.calls.get(key) ?? 0, settle,
      render: async items => { await act(async () => root.render(<Probe items={items} />)); await settle(); },
      // A sync-state change wakes every poller once (upstream behaviour), standing in for the interval.
      cycle: async () => { await act(async () => { useSyncEventsLive.setState({ baseUrl: `synthetic-tick-${++tick}` }); }); await settle(); },
      reconnect: async () => { await act(async () => { win.dispatchEvent(new Event(PROJECT_FOLDER_RECONNECTED_EVENT)); }); await settle(); },
    });
  } finally {
    await act(async () => root.unmount());
    expect(parked.size).toBe(0);
  }
}

test("an unavailable folder pauses only its own generation until reconnect or root change", async () => {
  const items = [workspace("sg-a"), workspace("sg-b"), workspace("sg-c")];
  await mount(async ({ server, warnings, count, render, cycle, reconnect }) => {
    // Initial cycle: sg-a fails as unavailable, the others synchronize.
    expect(count("sg-a:events")).toBe(1);
    expect(groups("sg-b")).toEqual(["sg-b-state"]);
    expect(warnings()).toBe(1);
    for (let index = 0; index < 4; index++) await cycle();
    // (1) later cycles do not poll the paused generation; (2) other workspaces keep polling.
    expect(count("sg-a:events")).toBe(1);
    expect(count("sg-a:state")).toBe(0);
    expect(count("sg-b:events")).toBe(5);
    expect(count("sg-c:events")).toBe(5);
    expect(warnings()).toBe(1);
    // (3) explicit reconnect resumes it and it synchronizes again.
    server.unavailable.delete("sg-a");
    await reconnect();
    expect(count("sg-a:events")).toBe(2);
    expect(groups("sg-a")).toEqual(["sg-a-state"]);
    // Missing again: paused again, once more with a single warning.
    server.unavailable.add("sg-a"); server.changed.add("sg-a");
    await cycle(); await cycle();
    expect(count("sg-a:events")).toBe(3);
    expect(warnings()).toBe(2);
    // (3) a changed root starts a new generation without an explicit reconnect.
    server.unavailable.delete("sg-a"); server.label.set("sg-a", "sg-a-moved");
    await render([workspace("sg-a", "/synthetic/moved"), workspace("sg-b"), workspace("sg-c")]);
    expect(count("sg-a:events")).toBe(4);
    expect(groups("sg-a")).toEqual(["sg-a-moved"]);
    // Metadata-only rerenders keep the generation and do not repeat initial reads.
    const reads = count("sg-b:state");
    await render([workspace("sg-a", "/synthetic/moved"), { ...workspace("sg-b"), displayNameResolved: "Renamed" }, workspace("sg-c")]);
    await cycle();
    expect(count("sg-b:state")).toBe(reads);
  }, items, ["sg-a"]);
});

test("late responses of a retired generation neither pause nor apply", async () => {
  const items = [workspace("sg-a"), workspace("sg-b")];
  await mount(async ({ server, warnings, count, render, cycle, reconnect, settle }) => {
    expect(groups("sg-a")).toEqual(["sg-a-state"]);
    expect(groups("sg-b")).toEqual(["sg-b-state"]);
    // (4a) a failure that started before an explicit reconnect does not pause the new generation.
    const failure = gate();
    server.hold.set("sg-a:events", failure.promise); server.unavailable.add("sg-a");
    await cycle();
    expect(count("sg-a:events")).toBe(2);
    server.unavailable.delete("sg-a");
    await act(async () => { window.dispatchEvent(new Event(PROJECT_FOLDER_RECONNECTED_EVENT)); });
    failure.release(); await settle();
    expect(warnings()).toBe(0);
    // The reconnect wakeup was coalesced and runs once the late cycle finishes.
    expect(count("sg-a:events")).toBe(3);
    await cycle();
    expect(count("sg-a:events")).toBe(4);
    // (4b) a state read of the old root that resolves after a root change is not applied.
    const late = gate();
    server.changed.add("sg-b"); server.label.set("sg-b", "sg-b-stale");
    server.hold.set("sg-b:state", late.promise);
    await cycle();
    expect(count("sg-b:state")).toBe(2);
    await render([workspace("sg-a"), workspace("sg-b", "/synthetic/sg-b-moved")]);
    late.release(); await settle();
    expect(groups("sg-b")).toEqual(["sg-b-state"]);
    // The current generation reads the state again and applies it.
    server.label.set("sg-b", "sg-b-fresh");
    await cycle();
    expect(groups("sg-b")).toEqual(["sg-b-fresh"]);
    // A reconnect while nothing is paused only refreshes once.
    await reconnect();
    expect(warnings()).toBe(0);
  }, items);
});

test("admission settles batch results per generation: pause, retire, keep other failures", () => {
  const keys = new Map([["one", "one/root-a"], ["two", "two/root-b"], ["three", "three/root-c"]]);
  const paused: string[] = [];
  const admission = new SessionGroupSyncAdmission({ liveKey: id => keys.get(id), onPause: id => { paused.push(id); } });
  const unavailable = new LegalworkServerError(404, "project_folder_unavailable", "missing");
  const offline = new LegalworkServerError(503, "request_failed", "offline");
  const tickets = ["one", "two", "three"].map(id => admission.admit(id));
  const items = tickets.flatMap(ticket => ticket ? [{ ticket }] : []);
  expect(items).toHaveLength(3);
  keys.set("three", "three/root-new");
  const failed = admission.firstUnhandled(items, [
    { status: "rejected", reason: unavailable }, { status: "rejected", reason: offline }, { status: "rejected", reason: unavailable },
  ]);
  // The retired generation of "three" neither pauses nor masks the current failure of "two".
  expect(failed?.reason).toBe(offline);
  expect(paused).toEqual(["one"]);
  expect(admission.admit("one")).toBeNull();
  expect(admission.admit("three")).not.toBeNull();
  expect(admission.resumeChanged()).toBe(false);
  keys.set("one", "one/root-moved");
  expect(admission.resumeChanged()).toBe(true);
  expect(admission.admit("one")?.key).toBe("one/root-moved");
  const before = admission.admit("two");
  admission.reconnect();
  expect(before && admission.isCurrent(before)).toBe(false);
});

test("the batch poller does not apply a late state of a retired root", async () => {
  await mount(async ({ server, count, render, cycle, settle }) => {
    expect(groups("sg-a")).toEqual(["sg-a-state"]);
    expect(groups("sg-b")).toEqual(["sg-b-state"]);
    const late = gate();
    server.changed.add("sg-a"); server.changed.add("sg-b");
    server.label.set("sg-a", "sg-a-new"); server.label.set("sg-b", "sg-b-stale");
    server.hold.set("batch", late.promise);
    await cycle();
    expect(count("sg-b:batch")).toBe(2);
    await render([workspace("sg-a"), workspace("sg-b", "/synthetic/sg-b-moved")]);
    late.release(); await settle();
    expect(groups("sg-a")).toEqual(["sg-a-new"]);
    expect(groups("sg-b")).toEqual(["sg-b-state"]);
    server.label.set("sg-b", "sg-b-fresh");
    await cycle();
    expect(groups("sg-b")).toEqual(["sg-b-fresh"]);
    expect(count("sg-a:events") + count("sg-a:state")).toBe(0);
  }, [workspace("sg-a"), workspace("sg-b")], [], true);
});
