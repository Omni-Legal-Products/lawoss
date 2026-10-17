import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LegalWorkToolOutput } from "./legalwork-tool-output.js";

let root: string;
let directory: string;
let outputPath: string;
let previousData: string | undefined;
let current = "child";
let approvals: string[] = [];
const sessions = new Map<string, { id: string; directory: string; parentID?: string }>();
const messages = new Map<string, unknown>();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "saved-tool-output-"));
  directory = join(root, "project");
  outputPath = join(root, "opencode", "tool-output", "tool_fixture");
  await mkdir(join(root, "opencode", "tool-output"), { recursive: true });
  previousData = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = root;
  current = "child";
  approvals = [];
  sessions.clear(); messages.clear();
  for (const id of ["parent", "child", "unrelated"]) {
    sessions.set(id, { id, directory, ...(id === "child" ? { parentID: "parent" } : {}) });
    messages.set(id, []);
  }
  messages.set("parent", [{ parts: [{ type: "tool", state: { status: "completed", metadata: { truncated: true, outputPath } } }] }]);
});
afterEach(async () => {
  if (previousData === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previousData;
  await rm(root, { recursive: true, force: true });
});

function plugin() {
  return LegalWorkToolOutput({ directory, client: { session: {
    get: async ({ path }) => ({ data: sessions.get(path.id) }),
    messages: async ({ path }) => ({ data: messages.get(path.id) }),
  } } });
}
async function read(input: Record<string, unknown> = {}, deny?: string) {
  const tools = (await plugin()).tool;
  return JSON.parse(await tools.legalwork_tool_output_read.execute({ outputPath, ...input }, {
    directory, sessionID: current,
    ask: async ({ permission }) => { approvals.push(permission); if (permission === deny) throw new Error("Permission denied"); },
  }));
}

test("a child recovers exact content beyond the long-line and 64 KiB boundaries", async () => {
  const content = JSON.stringify({ padding: "a".repeat(80000), result: "complete requested section" });
  await writeFile(outputPath, content);
  const match = await read({ query: "complete requested section" });
  expect(match.found).toBe(true);
  expect(match.matchOffset).toBeGreaterThan(65536);
  expect(match.text).toContain("complete requested section");
  const page = await read({ offset: match.matchOffset });
  expect(page.text).toBe(content.slice(match.matchOffset));
  expect(page.nextOffset).toBeNull();
  expect(approvals).toEqual(["legalwork_tool_output_read", "read", "legalwork_tool_output_read", "read"]);
});

test("successive UTF-8 byte pages reconstruct a single long line exactly", async () => {
  const content = "a".repeat(4096) + "\uFEFF" + "abcdé🙂東京".repeat(5000);
  await writeFile(outputPath, content);
  let offset: number | null = 0;
  let recovered = "";
  while (offset !== null) {
    const result = await read({ offset, limit: 4096 });
    expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(4096);
    recovered += result.text;
    offset = result.nextOffset;
  }
  expect(recovered).toBe(content);
  await expect(read({ offset: 4097 })).rejects.toThrow("UTF-8");
});

test("search has bounded scans, finds boundary-spanning matches and continues", async () => {
  const content = "a".repeat(1024 * 1024 - 2) + "needle" + "a".repeat(1024 * 1024) + "needle";
  await writeFile(outputPath, content);
  const first = await read({ query: "needle" });
  expect(first.matchOffset).toBe(1024 * 1024 - 2);
  const second = await read({ query: "needle", offset: first.nextOffset });
  expect(second.found).toBe(false);
  expect(second.nextOffset).not.toBeNull();
  const third = await read({ query: "needle", offset: second.nextOffset });
  expect(third.text).toContain("needle");
  expect(third.nextOffset).toBeNull();
  expect(await read({ query: "missing", offset: content.length })).toMatchObject({ found: false, nextOffset: null });
});

test("unrelated chats, siblings and unverified result text confer no access", async () => {
  await writeFile(outputPath, "private fixture");
  current = "unrelated";
  messages.set(current, [{ parts: [{ type: "text", text: outputPath }, { type: "tool", state: { status: "completed", metadata: { outputPath, truncated: false } } }] }]);
  await expect(read()).rejects.toThrow("does not belong");
  expect(approvals).toEqual([]);
  current = "parent";
  messages.set("child", messages.get("parent"));
  messages.set("parent", []);
  await expect(read()).rejects.toThrow("does not belong");
});

test("parent lineage cannot cross projects or loop", async () => {
  await writeFile(outputPath, "fixture");
  sessions.set("parent", { id: "parent", directory: join(root, "different-project") });
  await expect(read()).rejects.toThrow("does not belong");
  sessions.set("parent", { id: "parent", directory, parentID: "child" });
  messages.set("parent", []);
  await expect(read()).rejects.toThrow("does not belong");
});

test("files outside engine storage and symlinks are refused even with metadata", async () => {
  const outside = join(root, "tool_secret");
  await writeFile(outside, "not an output");
  messages.set("parent", [{ parts: [{ type: "tool", state: { status: "completed", metadata: { truncated: true, outputPath: outside } } }] }]);
  await expect(read({ outputPath: outside })).rejects.toThrow("Only an engine-saved");
  messages.set("parent", [{ parts: [{ type: "tool", state: { status: "completed", metadata: { truncated: true, outputPath } } }] }]);
  await symlink(outside, outputPath);
  await expect(read()).rejects.toThrow("regular file");
});

test("denials, missing identity and expired output files fail closed", async () => {
  await writeFile(outputPath, "fixture");
  await expect(read({}, "read")).rejects.toThrow("Permission denied");
  await expect(read({}, "legalwork_tool_output_read")).rejects.toThrow("Permission denied");
  const tools = (await plugin()).tool;
  await expect(tools.legalwork_tool_output_read.execute({ outputPath }, { directory })).rejects.toThrow("identity");
  await expect(tools.legalwork_tool_output_read.execute({ outputPath }, { directory, sessionID: current })).rejects.toThrow("permissions");
  await rm(outputPath);
  await expect(read()).rejects.toThrow();
});

test("page sizes and offsets are bounded and newline-heavy output stays one JSON record", async () => {
  await writeFile(outputPath, "\u0000\n".repeat(5000));
  const result = await read({ limit: 4096 });
  expect(result.text).toBe("\u0000\n".repeat(2048));
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(50 * 1024);
  await expect(read({ limit: 100000 })).rejects.toThrow();
  await expect(read({ offset: -1 })).rejects.toThrow();
  await expect(read({ offset: 100000 })).rejects.toThrow("beyond");
});
