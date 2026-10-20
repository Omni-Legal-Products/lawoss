import { expect, test } from "bun:test";
import { SessionGroupSyncController } from "../src/react-app/shell/session-group-sync-controller";

type Target = { key: string; id: string };
function setup() {
  let now = 0;
  let targets: Target[] = [{ key: "one/root-a", id: "one" }, { key: "two/root-b", id: "two" }];
  const calls: string[] = [];
  const errors: string[] = [];
  const unavailable = new Error("missing folder");
  let fail: Error | undefined;
  let hold: Promise<void> | undefined;
  let current: (() => boolean) | undefined;
  const controller = new SessionGroupSyncController<Target>({
    targets: () => targets, now: () => now,
    async sync(target, migrate, isCurrent) { calls.push(`sync:${target.key}:${migrate}`); current = isCurrent; if (target.id === "one") { if (fail) throw fail; await hold; } },
    async events(target, since) { calls.push(`events:${target.key}:${since ?? "none"}`); if (target.id === "one" && fail) throw fail; return { cursor: 2, items: since === undefined ? [] : [{ seq: 2 }] }; },
    isUnavailable: error => error === unavailable,
    onError: target => { errors.push(target.id); },
  });
  return { controller, calls, errors, unavailable,
    set now(value: number) { now = value; }, set targets(value: Target[]) { targets = value; },
    set fail(value: Error | undefined) { fail = value; }, set hold(value: Promise<void> | undefined) { hold = value; },
    get current() { return current; },
  };
}

test("metadata rerenders do not repeat successful initial migration", async () => {
  const s = setup();
  await s.controller.refresh();
  s.targets = [{ key: "one/root-a", id: "one" }, { key: "two/root-b", id: "two" }];
  await s.controller.refresh();
  expect(s.calls.filter(call => call.startsWith("sync:"))).toEqual(["sync:one/root-a:true", "sync:two/root-b:true"]);
});

test("missing project stays paused for thirty minutes while another project polls", async () => {
  const s = setup(); s.fail = s.unavailable;
  await s.controller.refresh();
  for (let tick = 1; tick <= 600; tick++) { s.now = tick * 3000; await s.controller.refresh(); }
  expect(s.calls.filter(call => call.includes("one/root-a"))).toEqual(["sync:one/root-a:true"]);
  expect(s.calls.filter(call => call.startsWith("events:two"))).toHaveLength(600);
  expect(s.errors).toEqual(["one"]);
});

test("initial failures and polling share exponential backoff without repeated warnings", async () => {
  const s = setup(); s.fail = new Error("offline");
  await s.controller.refresh();
  s.now = 5999; await s.controller.refresh();
  expect(s.calls.filter(call => call.startsWith("sync:one"))).toHaveLength(1);
  s.now = 6000; await s.controller.refresh();
  s.now = 17999; await s.controller.refresh();
  expect(s.calls.filter(call => call.startsWith("sync:one"))).toHaveLength(2);
  expect(s.errors).toEqual(["one"]);
  s.now = 18000; s.fail = undefined; await s.controller.refresh();
  expect(s.calls.filter(call => call.startsWith("sync:one"))).toHaveLength(3);
  s.now = 21000; await s.controller.refresh();
  expect(s.calls).toContain("events:one/root-a:none");
});

test("explicit reconnect resumes a paused root and changed root starts a fresh migration", async () => {
  const s = setup(); s.fail = s.unavailable; await s.controller.refresh();
  s.fail = undefined; await s.controller.reconnect();
  expect(s.calls.filter(call => call.startsWith("sync:one"))).toHaveLength(2);
  s.targets = [{ key: "one/root-new", id: "one" }]; await s.controller.refresh();
  expect(s.calls).toContain("sync:one/root-new:true");
});

test("overlapping refreshes admit only one operation per workspace", async () => {
  const s = setup(); let release!: () => void;
  s.hold = new Promise<void>(resolve => { release = resolve; });
  const first = s.controller.refresh(); await s.controller.refresh();
  expect(s.calls.filter(call => call.startsWith("sync:one"))).toHaveLength(1);
  expect(s.calls).toContain("sync:two/root-b:true");
  release(); await first;
});

test("removed generation and disposed owner cannot apply a late response", async () => {
  const s = setup(); s.targets = [{ key: "one/root-a", id: "one" }];
  let release!: () => void; s.hold = new Promise<void>(resolve => { release = resolve; });
  const first = s.controller.refresh(); const oldCurrent = s.current;
  expect(oldCurrent?.()).toBe(true);
  s.targets = [{ key: "one/new-root", id: "one" }];
  const next = s.controller.refresh();
  expect(oldCurrent?.()).toBe(false);
  s.controller.dispose(); expect(s.current?.()).toBe(false);
  release(); await Promise.all([first, next]);
  const count = s.calls.length; await s.controller.refresh(); expect(s.calls).toHaveLength(count);
});

test("event changes refresh server state without repeating local migration", async () => {
  const s = setup(); s.targets = [{ key: "two/root-b", id: "two" }];
  await s.controller.refresh(); await s.controller.refresh(); await s.controller.refresh();
  expect(s.calls).toEqual(["sync:two/root-b:true", "events:two/root-b:none", "events:two/root-b:2", "sync:two/root-b:false"]);
});

test("reconnect during a failed in-flight read retries once after that owner releases", async () => {
  let recovered = false; let release!: () => void; let calls = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const controller = new SessionGroupSyncController({ targets: () => [{ key: "same-root" }],
    async sync() { calls++; const wasUnavailable = !recovered; if (calls === 1) await pending; if (wasUnavailable) throw new Error("missing"); },
    async events() { return { items: [] }; }, isUnavailable: () => true, onError() {},
  });
  const first = controller.refresh(); recovered = true; await controller.reconnect(); release(); await first;
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(calls).toBe(2);
  controller.dispose();
});
