import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import { createProjectSyncFirstFailureTiming } from "./project-sync-first-failure-timing.js";

const enabled = { LAWOSS_PROJECT_SYNC_TEST_DIAGNOSTICS: "1", CI: "true", GITHUB_ACTIONS: "true" };
const prefix = "LAWOSS_PROJECT_SYNC_FIRST_FAILURE ";

function fixture(env: Readonly<Record<string, string | undefined>> = enabled) {
  let time = 0;
  let reads = 0;
  const frames: string[] = [];
  const observer = createProjectSyncFirstFailureTiming({
    env,
    now: () => { reads++; return time; },
    write: (frame) => { frames.push(frame); },
  });
  return { observer, frames, advance: (value: number) => { time = value; }, reads: () => reads };
}

function payload(frame: string) {
  expect(frame.startsWith(prefix)).toBe(true);
  expect(frame.endsWith("\n")).toBe(true);
  expect(Buffer.byteLength(frame, "utf8")).toBeLessThanOrEqual(8192);
  return JSON.parse(frame.slice(prefix.length));
}

describe("first project-sync failure statement observation", () => {
  test("requires all three exact flags, reads no disabled clock and keeps a passing fixture quiet", () => {
    for (const [key, expected] of Object.entries(enabled)) {
      for (const value of [undefined, "", "TRUE", "false", "0", "1 ", "1", "true"].filter((value) => value !== expected)) {
        const f = fixture({ ...enabled, [key]: value });
        f.observer.enter(25);
        f.observer.failed();
        f.observer.settled();
        f.observer.cleanupEntry(3);
        f.observer.cleanupExit(true, 2);
        expect(f.frames).toEqual([]);
        expect(f.reads()).toBe(0);
      }
    }
    const missing = fixture({});
    missing.observer.cleanupEntry(0);
    expect(missing.reads()).toBe(0);
    expect(missing.frames).toEqual([]);
    const f = fixture();
    f.observer.enter(39);
    f.observer.done(39);
    f.observer.complete();
    f.observer.settled();
    f.observer.cleanupEntry(0);
    f.observer.cleanupExit(false, 0);
    expect(f.frames).toEqual([]);
  });

  test("freezes pending outer statement 25 at cleanup entry without inventing terminal cleanup", () => {
    const f = fixture();
    f.observer.enter(24);
    f.observer.done(24);
    f.observer.enter(25);
    f.advance(5000);
    f.observer.cleanupEntry(4);
    expect(f.frames).toHaveLength(1);
    expect(payload(f.frames[0])).toMatchObject({
      protocol: "project-sync-first-failure", schema: 1, case: "revoke", kind: "body",
      elapsedMs: 5000, bodyComplete: false, bodySettled: false, bodyFailed: false,
      currentStatement: 25, lastCompletedStatement: 24, cleanupCount: 4, dropped: 0,
    });
    f.advance(9000);
    expect(f.frames).toHaveLength(1);
  });

  test("late A continuations cannot mutate its bytes or B after A freezes", () => {
    const a = fixture();
    a.observer.enter(25);
    a.observer.cleanupEntry(1);
    const bytes = a.frames[0];
    const b = fixture();
    b.observer.enter(3);
    a.advance(12000);
    a.observer.done(25);
    a.observer.failed();
    a.observer.complete();
    a.observer.settled();
    a.observer.cleanupEntry(500);
    expect(a.frames).toEqual([bytes]);
    b.observer.cleanupEntry(2);
    expect(payload(b.frames[0])).toMatchObject({ currentStatement: 3, bodyFailed: false, bodySettled: false });
    expect(payload(bytes)).toMatchObject({ currentStatement: 25, bodyFailed: false, bodySettled: false });
  });

  test("body rethrow and the unchanged miniature LIFO drain preserve identity, fail-fast and remainder", async () => {
    const bodyError = { privateText: "private-body-error" };
    const cleanupError = { privateText: "private-cleanup-error" };
    for (const env of [{}, enabled]) {
      const f = fixture(env);
      let caughtBody: unknown;
      try {
        try {
          f.observer.enter(12);
          throw bodyError;
        } catch (error) {
          f.observer.failed();
          throw error;
        } finally {
          f.observer.settled();
        }
      } catch (error) { caughtBody = error; }
      const calls: number[] = [];
      const cleanups = [
        async () => { calls.push(1); },
        async () => { calls.push(2); throw cleanupError; },
        async () => { calls.push(3); },
      ];
      f.observer.cleanupEntry(cleanups.length);
      let caughtCleanup: unknown;
      try {
        try {
          while (cleanups.length) await cleanups.pop()?.();
        } catch (error) {
          f.observer.cleanupExit(true, cleanups.length);
          throw error;
        }
        f.observer.cleanupExit(false, cleanups.length);
      } catch (error) { caughtCleanup = error; }
      expect(caughtBody).toBe(bodyError);
      expect(caughtCleanup).toBe(cleanupError);
      expect(calls).toEqual([3, 2]);
      expect(cleanups).toHaveLength(1);
      if (env === enabled) {
        expect(f.frames).toHaveLength(2);
        expect(payload(f.frames[0])).toMatchObject({ bodyFailed: true, bodySettled: true, currentStatement: 12 });
        expect(payload(f.frames[1])).toMatchObject({ kind: "cleanup", exited: false, rejected: true, remainingCallbacks: 1 });
        expect(f.frames.join("")).not.toContain("private-");
      } else expect(f.frames).toEqual([]);
    }
  });

  test("cleanup rejection after a completed body is still reported and successful drain has a distinct receipt", () => {
    const complete = fixture();
    complete.observer.complete();
    complete.observer.settled();
    complete.observer.cleanupEntry(2);
    expect(complete.frames).toEqual([]);
    complete.observer.cleanupExit(true, 1);
    expect(complete.frames).toHaveLength(1);
    expect(payload(complete.frames[0])).toMatchObject({ kind: "cleanup", rejected: true, exited: false });
    const pending = fixture();
    pending.observer.cleanupEntry(2);
    pending.observer.cleanupExit(false, 0);
    expect(pending.frames).toHaveLength(2);
    expect(payload(pending.frames[1])).toMatchObject({ kind: "cleanup", rejected: false, exited: true, remainingCallbacks: 0 });
  });

  test("bounded chunks keep the unfinished current statement after the event cap and reject invalid inputs", () => {
    const f = fixture();
    for (let chunk = 0; chunk < 4; chunk++) {
      for (let i = 0; i < 20; i++) {
        f.advance(chunk * 100 + i);
        f.observer.enter(1);
        f.observer.done(1);
      }
    }
    f.observer.enter(39);
    for (const invalid of [-1, 0, 40, 1.5, NaN, Infinity, -Infinity]) {
      f.observer.enter(invalid);
      f.observer.done(invalid);
    }
    Reflect.apply(f.observer.enter, f.observer, ["private-statement"]);
    Reflect.apply(f.observer.done, f.observer, ["private-statement"]);
    f.advance(-10);
    f.observer.cleanupEntry(1e20);
    const body = payload(f.frames[0]);
    expect(body.events).toHaveLength(96);
    expect(body.dropped).toBe(66);
    expect(body.currentStatement).toBe(39);
    expect(body.lastCompletedStatement).toBe(1);
    expect(body.cleanupCount).toBe(65535);
    expect(body.elapsedMs).toBe(319);
    let previous = 0;
    for (const event of body.events) {
      expect(event.elapsedMs).toBeGreaterThanOrEqual(previous);
      previous = event.elapsedMs;
    }
    f.advance(Infinity);
    f.observer.cleanupExit(false, NaN);
    expect(payload(f.frames[1])).toMatchObject({ elapsedMs: 319, remainingCallbacks: 0 });
  });

  test("saturates elapsed and dropped counts without losing current phase or exceeding a frame", () => {
    const f = fixture();
    f.advance(1e20);
    for (let i = 0; i < 66000; i++) f.observer.enter(25);
    f.observer.cleanupEntry(-1);
    const body = payload(f.frames[0]);
    expect(body.elapsedMs).toBe(2147483647);
    expect(body.dropped).toBe(65535);
    expect(body.currentStatement).toBe(25);
    expect(body.cleanupCount).toBe(0);
    const nonfinite = fixture();
    nonfinite.advance(NaN);
    nonfinite.observer.enter(25);
    nonfinite.observer.cleanupEntry(Infinity);
    expect(payload(nonfinite.frames[0])).toMatchObject({ elapsedMs: 0, currentStatement: 25, cleanupCount: 0 });
  });

  test("runtime-invalid callback counts and rejection values cannot inject private content", () => {
    const f = fixture();
    Reflect.apply(f.observer.cleanupEntry, f.observer, ["private-count"]);
    Reflect.apply(f.observer.cleanupExit, f.observer, ["private-rejection", "private-count"]);
    expect(f.frames).toHaveLength(2);
    expect(payload(f.frames[0])).toMatchObject({ cleanupCount: 0 });
    expect(payload(f.frames[1])).toMatchObject({ rejected: false, exited: true, remainingCallbacks: 0 });
    expect(f.frames.join("")).not.toContain("private-");
  });

  test("publication is closed and at most once across reentrant throwing writers and repeated callbacks", () => {
    const frames: string[] = [];
    let observer: ReturnType<typeof createProjectSyncFirstFailureTiming>;
    observer = createProjectSyncFirstFailureTiming({
      env: enabled, now: () => 0,
      write: (frame) => {
        frames.push(frame);
        observer.done(25);
        observer.failed();
        observer.settled();
        observer.cleanupEntry(9);
        observer.cleanupExit(true, 1);
        throw { privateText: "private-writer-error" };
      },
    });
    observer.enter(25);
    expect(() => observer.cleanupEntry(2)).not.toThrow();
    observer.cleanupExit(false, 0);
    observer.cleanupExit(true, 8);
    expect(frames).toHaveLength(2);
    const body = payload(frames[0]);
    const cleanup = payload(frames[1]);
    expect(Object.keys(body).sort()).toEqual([
      "bodyComplete", "bodyFailed", "bodySettled", "case", "cleanupCount", "currentStatement", "dropped",
      "elapsedMs", "events", "kind", "lastCompletedStatement", "protocol", "schema",
    ]);
    expect(Object.keys(cleanup).sort()).toEqual([
      "case", "elapsedMs", "exited", "kind", "protocol", "rejected", "remainingCallbacks", "schema",
    ]);
    expect(body).toMatchObject({ currentStatement: 25, bodyFailed: false, bodySettled: false });
    expect(cleanup).toMatchObject({ rejected: true, exited: false, remainingCallbacks: 1 });
    expect(frames.join("")).not.toContain("private-");
    for (const event of body.events) expect(Object.keys(event).sort()).toEqual(["elapsedMs", "kind", "statement"]);
  });
});

// The break caught here is an unbounded, mis-scoped or lifecycle-changing
// diagnostic. These tests use controlled clocks and the real observer only.
const settingsPrefix = "LAWOSS_PROJECT_SYNC_SETTINGS_FIRST_FAILURE ";
const newLinkFlow = [
  "callback-enter", "connection-enter", "connection-done", "project-store-enter", "project-store-done",
  "task-store-enter", "task-store-done", "link-checks-enter", "link-checks-done", "metadata-enter",
  "metadata-done", "mutations-enter", "mutations-done", "schedule-enter", "schedule-done", "status-call",
] as const;
const existingLinkFlow = newLinkFlow.filter((checkpoint) => !checkpoint.startsWith("metadata-"));

function settingsCallback(f: ReturnType<typeof fixture>) {
  expect(typeof f.observer.settingsCheckpoint).toBe("function");
  if (!f.observer.settingsCheckpoint) throw new Error("Missing settings observer");
  return f.observer.settingsCheckpoint;
}
function firstSettings(f: ReturnType<typeof fixture>) {
  f.observer.enter(4);
  f.observer.done(4);
  f.observer.enter(5);
  return settingsCallback(f);
}
function settingsPayload(frames: string[]) {
  const selected = frames.filter((frame) => frame.startsWith(settingsPrefix));
  expect(selected).toHaveLength(1);
  const frame = selected[0];
  expect(frame.endsWith("\n")).toBe(true);
  expect(Buffer.byteLength(frame, "utf8")).toBeLessThanOrEqual(4096);
  const result = JSON.parse(frame.slice(settingsPrefix.length));
  expect(Object.keys(result).sort()).toEqual([
    "case", "currentCheckpoint", "elapsedMs", "events", "kind", "outcome", "protocol", "schema", "statement",
  ]);
  expect(result).toMatchObject({ protocol: "project-sync-settings-first-failure", schema: 1, case: "revoke", statement: 5, kind: "settings" });
  let previous = 0;
  for (const event of result.events) {
    expect(Object.keys(event).sort()).toEqual(["checkpoint", "elapsedMs"]);
    expect(newLinkFlow).toContain(event.checkpoint);
    expect(Number.isInteger(event.elapsedMs)).toBe(true);
    expect(event.elapsedMs).toBeGreaterThanOrEqual(previous);
    expect(event.elapsedMs).toBeLessThanOrEqual(result.elapsedMs);
    previous = event.elapsedMs;
  }
  expect(result.events.length).toBeLessThanOrEqual(16);
  expect(Number.isInteger(result.elapsedMs)).toBe(true);
  expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(result.elapsedMs).toBeLessThanOrEqual(2147483647);
  expect(result.currentCheckpoint).toBe(result.events.at(-1)?.checkpoint ?? null);
  return result;
}

describe("first settings invocation failure observation", () => {
  test("disabled exact-flag gates expose no callback and never sample the clock", () => {
    for (const [key, value] of Object.entries(enabled)) {
      for (const wrong of [undefined, "", "TRUE", "1 ", "false", "1", "true"].filter((v) => v !== value)) {
        const f = fixture({ ...enabled, [key]: wrong });
        expect(f.observer.settingsCheckpoint).toBeUndefined();
        f.observer.enter(5);
        f.observer.cleanupEntry(0);
        expect(f.frames).toEqual([]);
        expect(f.reads()).toBe(0);
      }
    }
  });

  test("every initial prefix of either legal flow freezes as pending or caught-failure, including no callback entry", () => {
    for (const flow of [newLinkFlow, existingLinkFlow]) {
      for (let length = 0; length <= flow.length; length++) {
        for (const caught of [false, true]) {
          const f = fixture();
          const checkpoint = firstSettings(f);
          for (const [index, name] of flow.slice(0, length).entries()) {
            f.advance(index + 1);
            checkpoint(name);
          }
          if (caught) { f.observer.failed(); f.observer.settled(); }
          f.advance(100);
          f.observer.cleanupEntry(3);
          const result = settingsPayload(f.frames);
          expect(result.outcome).toBe(caught ? "caught-failure" : "pending");
          expect(result.events).toEqual(flow.slice(0, length).map((name, index) => ({ checkpoint: name, elapsedMs: index + 1 })));
          expect(result.elapsedMs).toBe(100);
        }
      }
    }
  });

  test("rejects unknown, secret-bearing, duplicate and skipped checkpoints without clock reads", () => {
    const f = fixture();
    const checkpoint = settingsCallback(f);
    const rejected = () => {
      const reads = f.reads();
      for (const value of ["private-path-error", null, {}, 5, "status-call", "connection-done"]) Reflect.apply(checkpoint, undefined, [value]);
      expect(f.reads()).toBe(reads);
    };
    rejected();
    firstSettings(f);
    rejected();
    checkpoint("callback-enter");
    const reads = f.reads();
    checkpoint("callback-enter");
    checkpoint("project-store-enter");
    expect(f.reads()).toBe(reads);
    checkpoint("connection-enter");
    f.observer.cleanupEntry(1);
    expect(settingsPayload(f.frames).events.map((event: { checkpoint: string }) => event.checkpoint)).toEqual(["callback-enter", "connection-enter"]);
    expect(f.frames.join("")).not.toContain("private-");
  });

  test("first entry only disarms on done, failed, settled, complete or leaving5; later settings calls cannot resume it", () => {
    for (const stop of ["done", "failed", "settled", "complete", "leave"] as const) {
      const f = fixture(); const checkpoint = firstSettings(f);
      checkpoint("callback-enter");
      if (stop === "done") f.observer.done(5);
      else if (stop === "leave") f.observer.enter(6);
      else f.observer[stop]();
      f.observer.enter(5);
      const reads = f.reads();
      checkpoint("connection-enter");
      expect(f.reads()).toBe(reads);
      f.observer.cleanupEntry(0);
      // Even synthetic repeated outer5 cannot admit a later invocation.
      for (const frame of f.frames.filter((line) => line.startsWith(settingsPrefix))) {
        expect(JSON.parse(frame.slice(settingsPrefix.length)).events).toHaveLength(1);
      }
    }
  });

  test("passed settings, later body failure, other statements, cleanup-only and inconsistent body states emit no settings frame", () => {
    for (const mode of ["pass", "later", "other", "cleanup", "failed-only", "settled-only", "wrong-previous"]) {
      const f = fixture();
      if (mode === "wrong-previous") f.observer.enter(5);
      else firstSettings(f);
      if (mode === "pass" || mode === "later" || mode === "cleanup") f.observer.done(5);
      if (mode === "later" || mode === "other") f.observer.enter(6);
      if (mode === "later" || mode === "failed-only") f.observer.failed();
      if (mode === "pass" || mode === "cleanup") f.observer.complete();
      if (mode === "pass" || mode === "cleanup" || mode === "later" || mode === "settled-only") f.observer.settled();
      f.observer.cleanupEntry(0);
      f.observer.cleanupExit(mode === "cleanup", 0);
      expect(f.frames.filter((line) => line.startsWith(settingsPrefix))).toEqual([]);
    }
  });

  test("A and B keep independent bounded monotonic clocks; frozen and late callbacks are inert", () => {
    const a = fixture(); const ca = firstSettings(a);
    const b = fixture(); const cb = firstSettings(b);
    const values = [10, -10, NaN, Infinity, -Infinity, 1e20];
    newLinkFlow.forEach((name, index) => { a.advance(values[index % values.length]); ca(name); });
    a.observer.cleanupEntry(1);
    const bytes = a.frames.slice(); const reads = a.reads();
    a.advance(999); ca("callback-enter"); a.observer.done(5); a.observer.cleanupEntry(9);
    expect(a.frames).toEqual(bytes); expect(a.reads()).toBe(reads);
    expect(settingsPayload(a.frames).elapsedMs).toBe(2147483647);
    b.advance(2); cb("callback-enter"); b.observer.cleanupEntry(0);
    expect(settingsPayload(b.frames).events).toEqual([{ checkpoint: "callback-enter", elapsedMs: 2 }]);
  });

  test("a completed shorter flow rejects undefined and every late marker without clock reads", () => {
    const f = fixture(); const checkpoint = firstSettings(f);
    for (const name of existingLinkFlow) checkpoint(name);
    const reads = f.reads();
    for (const value of [undefined, null, "private-late", ...newLinkFlow]) Reflect.apply(checkpoint, undefined, [value]);
    expect(f.reads()).toBe(reads);
    f.observer.cleanupEntry(0);
    expect(settingsPayload(f.frames).events).toHaveLength(14);
  });

  test("all16 maximum-width times fit the independent4096B frame", () => {
    const f = fixture(); const checkpoint = firstSettings(f); f.advance(1e20);
    for (const name of newLinkFlow) checkpoint(name);
    for (let i = 0; i < 40; i++) checkpoint("status-call");
    f.observer.cleanupEntry(65535);
    expect(settingsPayload(f.frames).events).toHaveLength(16);
  });

  test("throwing clocks and reentrant throwing writers preserve frozen bytes and at-most-once publication", () => {
    const frames: string[] = [];
    let failClock = false;
    let observer: ReturnType<typeof createProjectSyncFirstFailureTiming>;
    observer = createProjectSyncFirstFailureTiming({ env: enabled,
      now: () => { if (failClock) throw { privateClock: "private-clock" }; return 0; },
      write: (frame) => {
        frames.push(frame);
        observer.settingsCheckpoint?.("connection-enter"); observer.done(5); observer.failed();
        observer.cleanupEntry(9); observer.cleanupExit(true, 1);
        throw { privateWriter: "private-writer" };
      },
    });
    observer.enter(4); observer.done(4); observer.enter(5);
    observer.settingsCheckpoint?.("callback-enter"); failClock = true;
    expect(() => observer.settingsCheckpoint?.("connection-enter")).not.toThrow();
    expect(() => observer.cleanupEntry(2)).not.toThrow();
    observer.cleanupExit(false, 0); observer.cleanupEntry(0);
    expect(frames).toHaveLength(3);
    expect(frames.map((line) => JSON.parse(line.slice(line.indexOf(" ") + 1)).kind)).toEqual(["body", "cleanup", "settings"]);
    expect(settingsPayload(frames)).toMatchObject({ outcome: "pending", currentCheckpoint: "connection-enter", elapsedMs: 0 });
    expect(payload(frames[0])).toMatchObject({ currentStatement: 5, bodyFailed: false, bodySettled: false });
    expect(frames.join("")).not.toContain("private-");
  });

  test("original body and cleanup wire bytes do not inherit the inner elapsed clamp or fields", () => {
    const expected = [
      'LAWOSS_PROJECT_SYNC_FIRST_FAILURE {"protocol":"project-sync-first-failure","schema":1,"case":"revoke","kind":"body","elapsedMs":30,"bodyComplete":false,"bodySettled":false,"bodyFailed":false,"currentStatement":5,"lastCompletedStatement":4,"cleanupCount":2,"events":[{"kind":"body-enter","statement":null,"elapsedMs":0},{"kind":"enter","statement":4,"elapsedMs":10},{"kind":"done","statement":4,"elapsedMs":10},{"kind":"enter","statement":5,"elapsedMs":20}],"dropped":0}\n',
      'LAWOSS_PROJECT_SYNC_FIRST_FAILURE {"protocol":"project-sync-first-failure","schema":1,"case":"revoke","kind":"cleanup","elapsedMs":40,"exited":false,"rejected":true,"remainingCallbacks":1}\n',
    ];
    for (const inner of [false, true]) {
      const f = fixture(); f.advance(10); f.observer.enter(4); f.observer.done(4);
      f.advance(20); f.observer.enter(5);
      if (inner) { f.advance(100); settingsCallback(f)("callback-enter"); }
      f.advance(30); f.observer.cleanupEntry(2);
      f.advance(40); f.observer.cleanupExit(true, 1);
      expect(f.frames.filter((line) => line.startsWith(prefix))).toEqual(expected);
      expect(settingsPayload(f.frames).elapsedMs).toBe(inner ? 100 : 30);
    }
  });

  test("settings first caught failure rethrows its untouched sentinel and leaves LIFO fail-fast unchanged", async () => {
    const f = fixture(); const original = { privateFailure: "private-failure" }; const cleanupError = {};
    let caught: unknown;
    try {
      try { firstSettings(f)("callback-enter"); throw original; }
      catch (error) { f.observer.failed(); throw error; }
      finally { f.observer.settled(); }
    } catch (error) { caught = error; }
    const calls: number[] = [];
    const cleanups = [async () => { calls.push(1); }, async () => { calls.push(2); throw cleanupError; }, async () => { calls.push(3); }];
    f.observer.cleanupEntry(3);
    let cleanupCaught: unknown;
    try { while (cleanups.length) await cleanups.pop()?.(); }
    catch (error) { f.observer.cleanupExit(true, cleanups.length); cleanupCaught = error; }
    expect(caught).toBe(original); expect(cleanupCaught).toBe(cleanupError);
    expect(calls).toEqual([3, 2]); expect(cleanups).toHaveLength(1);
    expect(settingsPayload(f.frames).outcome).toBe("caught-failure");
    expect(f.frames.join("")).not.toContain("private-");
  });
});

// Historical canonical function: exact 6ccc1bd258cc9632c2b92068bff50f67484b1619,
// SHA256 c2ed8a3eb1675d7c9b68c6443a79e61caed090ea25587aed0fb76b23733e7439.
// Integration reference independently composes exact dev34df1a4f08129a652d4cbd747853186b25a3bf81
// saveProjectSyncSettings with the preserved held withRuntimeDb wrapper only.
// Its new calendar-settings/personalization statement is intentional. No git,
// mutable-candidate hash derivation or snapshot refresh occurs at test runtime.
const frozenFunctionHash = "6f63631efa24b71557c9ec98796e4c82707e231e263f61eb30c5a2d5d0c50674";
const frozenSelectedTestHash = "69d34d0fab87a5d332945bc948cce4a6279a580a6d9dc2b53666eaea3f172277";
const printer = ts.createPrinter({ removeComments: true });
function sourceFile(relative: string) {
  return ts.createSourceFile(relative, readFileSync(new URL(relative, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
}
function printed(node: ts.Node, source: ts.SourceFile) {
  return printer.printNode(ts.EmitHint.Unspecified, node, source);
}
function digest(node: ts.Node, source: ts.SourceFile) {
  return createHash("sha256").update(printed(node, source)).digest("hex");
}
function nodes(root: ts.Node, predicate: (node: ts.Node) => boolean) {
  const found: ts.Node[] = [];
  function visit(node: ts.Node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(root);
  return found;
}
function marker(node: ts.Node): string | undefined {
  if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return;
  const call = node.expression;
  if (!ts.isIdentifier(call.expression) || call.expression.text !== "checkpoint") return;
  expect(call.questionDotToken?.kind).toBe(ts.SyntaxKind.QuestionDotToken);
  expect(call.arguments).toHaveLength(1);
  const name = call.arguments[0];
  if (!ts.isStringLiteral(name)) throw new Error("Checkpoint must be a fixed literal");
  expect(newLinkFlow.some((checkpoint) => checkpoint === name.text)).toBe(true);
  return name.text;
}

describe("settings observation source adoption and placement guards", () => {
  test("removes only the exact diagnostic nodes and reproduces the original function AST", () => {
    const source = sourceFile("../project-sync.ts");
    const fn = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "saveProjectSyncSettings");
    if (!fn?.body) throw new Error("Missing settings function");
    expect(fn.parameters).toHaveLength(4);
    expect(printed(fn.parameters[3], source)).toBe("diagnostic?: (checkpoint: ProjectSyncSettingsCheckpoint) => void");
    const union = source.statements.find((node): node is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(node) && node.name.text === "ProjectSyncSettingsCheckpoint");
    if (!union || !ts.isUnionTypeNode(union.type)) throw new Error("Missing fixed union");
    expect(union.type.types.map((node) => printed(node, source).replaceAll('"', ""))).toEqual([...newLinkFlow]);
    const wrapper = fn.body.statements[0];
    const expectedWrapper = ts.createSourceFile("wrapper.ts", `const checkpoint = diagnostic ? (value: ProjectSyncSettingsCheckpoint) => {
    try { diagnostic(value); } catch {}
  } : undefined;`, ts.ScriptTarget.Latest, true);
    expect(printed(wrapper, source)).toBe(printed(expectedWrapper.statements[0], expectedWrapper));
    expect(fn.body.statements).toHaveLength(2);
    const callback = nodes(fn.body.statements[1], ts.isArrowFunction).find((node): node is ts.ArrowFunction => ts.isArrowFunction(node));
    if (!callback || !ts.isBlock(callback.body)) throw new Error("Missing original runtime callback");
    let originalIndex = 0;
    const layout: string[] = [];
    function block(body: ts.Block) {
      for (const statement of body.statements) {
        const name = marker(statement);
        if (name) { layout.push(name); continue; }
        if (ts.isIfStatement(statement) && printed(statement.expression, source) === "!link") {
          layout.push(`original${originalIndex++}:new-link`);
          if (!ts.isBlock(statement.thenStatement) || !statement.elseStatement || !ts.isBlock(statement.elseStatement)) throw new Error("Original branch changed");
          block(statement.thenStatement); layout.push("else"); block(statement.elseStatement); layout.push("end-link");
        } else layout.push(`original${originalIndex++}`);
      }
    }
    block(callback.body);
    expect(layout).toEqual([
      "callback-enter", "connection-enter", "original0", "connection-done", "original1",
      "project-store-enter", "original2", "project-store-done", "task-store-enter", "original3", "task-store-done",
      "link-checks-enter", "original4", "original5", "original6", "link-checks-done", "original7:new-link",
      "metadata-enter", "original8", "original9", "metadata-done", "mutations-enter", "original10", "original11", "original12",
      "else", "mutations-enter", "original13", "original14", "original15", "original16", "original17", "end-link",
      "mutations-done", "schedule-enter", "original18", "schedule-done", "status-call", "original19",
    ]);
    expect(printed(callback.body.statements.at(-1)!, source)).toBe("return projectSyncStatus(config, workspace);");
    let removed = 0;
    const transformed = ts.transform(fn, [(context) => {
      const visit: ts.Visitor = (node) => {
        if (node === wrapper) return undefined;
        if (marker(node)) { removed++; return undefined; }
        const visited = ts.visitEachChild(node, visit, context);
        if (ts.isFunctionDeclaration(visited) && node === fn) return ts.factory.updateFunctionDeclaration(
          visited, visited.modifiers, visited.asteriskToken, visited.name, visited.typeParameters,
          visited.parameters.slice(0, 3), visited.type, visited.body,
        );
        return visited;
      };
      return (node) => ts.visitNode(node, visit) as ts.FunctionDeclaration;
    }]);
    try {
      expect(removed).toBe(17);
      expect(digest(transformed.transformed[0], source)).toBe(frozenFunctionHash);
    } finally { transformed.dispose(); }
  });

  test("only the selected first outer5 settings call gains an argument; the entire original fixture AST remains identical", () => {
    const source = sourceFile("../project-sync.test.ts");
    const supplied = nodes(source, (node) => ts.isCallExpression(node) && printed(node.expression, source) === "saveProjectSyncSettings" && node.arguments.length === 4);
    expect(supplied).toHaveLength(1);
    const selected = nodes(source, (node) => ts.isCallExpression(node) && node.arguments[0] !== undefined && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "a member taken off the project loses the copy — or decides, when changes made there had not reached the firm");
    expect(selected).toHaveLength(1);
    const call = supplied[0];
    if (!ts.isCallExpression(call)) throw new Error("Missing selected settings call");
    expect(printed(call.arguments[3], source)).toBe("observer.settingsCheckpoint");
    expect(nodes(selected[0], (node) => node === call)).toHaveLength(1);
    const parent = call.parent;
    if (!ts.isAwaitExpression(parent) || !ts.isExpressionStatement(parent.parent) || !ts.isBlock(parent.parent.parent)) throw new Error("Original await changed");
    const siblings = parent.parent.parent.statements;
    const index = siblings.indexOf(parent.parent);
    expect(printed(siblings[index - 1], source)).toBe("observer.enter(5);");
    expect(printed(siblings[index + 1], source)).toBe("observer.done(5);");
    const transformed = ts.transform(selected[0], [(context) => {
      const visit: ts.Visitor = (node) => node === call
        ? ts.factory.updateCallExpression(call, call.expression, call.typeArguments, call.arguments.slice(0, 3))
        : ts.visitEachChild(node, visit, context);
      return (node) => ts.visitNode(node, visit)!;
    }]);
    try { expect(digest(transformed.transformed[0], source)).toBe(frozenSelectedTestHash); }
    finally { transformed.dispose(); }
  });
});
